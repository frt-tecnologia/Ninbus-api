/**
 * Firmware Release Service — factory-managed global catalog.
 *
 * Write-through pattern (same as artifacts, minus the tenant filter):
 *  - upload: package → create SM in hawkBit → upload binary → insert locally
 *  - list/latest: DB-ONLY reads (no hawkBit calls — works with HAWKBIT_ENABLED=false)
 *  - delete: hawkBit SM first (locked → 409), then local row
 */
import { randomUUID } from 'node:crypto';
import { hawkbitConfig } from '@common/config/hawkbit';
import { db } from '@common/db';
import { deployments, firmwareReleases } from '@common/db/schema';
import {
	NINBUS_ARTIFACT_TYPES,
	getOrCreateSoftwareModuleType,
	hawkbitSoftwareModules,
} from '@common/hawkbit/client';
import { appLogger } from '@common/logger';
import { validateFileSize } from '@modules/artifacts/service';
import { packageArtifact } from '@modules/artifacts/tar-packager';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { OtaSignerError, buildNinbusTar, packVersionString } from './ota-signer';
import {
	type CanonicalArtifactType,
	InvalidPackageError,
	validateCanonicalTar,
} from './tar-validator';
import { compareVersions } from './versioning';

/** Firmware types accepted in the factory catalog (no configuration-nfx —
 *  that one is company-scoped operational data, not a firmware release). */
export const FIRMWARE_TYPES = [
	NINBUS_ARTIFACT_TYPES.NINBUS_FIRMWARE,
	NINBUS_ARTIFACT_TYPES.CONTROLLER_FIRMWARE,
] as const;

export class FirmwareValidationError extends Error {
	constructor(
		message: string,
		public readonly code:
			| 'INVALID_EXTENSION'
			| 'FILE_TOO_LARGE'
			| 'EMPTY_FILE'
			| 'MISSING_FILE'
			| 'HAWKBIT_NOT_ENABLED'
			| 'NOT_FOUND'
			| 'DUPLICATE_VERSION'
			| 'LOCKED'
			| 'INVALID_STATUS'
			| 'INVALID_PACKAGE'
			| 'SIGNING_KEY_NOT_CONFIGURED'
			| 'INVALID_KEY'
			| 'INVALID_IMAGE'
			| 'INVALID_COUNTER'
			| 'INVALID_SIGNATURE'
			| 'INVALID_VERSION'
			| 'COUNTER_FLOOR_BURNED'
			| 'GATE_FAILED'
			| 'REJECTED_ARTIFACT',
	) {
		super(message);
		this.name = 'FirmwareValidationError';
	}
}

// ---------------------------------------------------------------------------
// Version comparison — extracted to versioning.ts (pure, unit tested)
// ---------------------------------------------------------------------------
export { compareVersions } from './versioning';

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export interface FirmwareUploadInput {
	name: string;
	version: string;
	artifactType: (typeof FIRMWARE_TYPES)[number];
	description?: string;
}

/** Upload a factory firmware release to hawkBit + register in the local catalog. */
export async function uploadFirmwareRelease(
	userId: string,
	file: File,
	input: FirmwareUploadInput,
) {
	const isTar = file.name.toLowerCase().endsWith('.tar');
	// Device contract (v4 golden rule): firmware-ninbus ONLY as the canonical
	// signed .tar. Two equivalent paths, SAME interface:
	//   A) factory ran ota_sign.py + ota_pack.py → upload the .tar (verbatim)
	//   B) raw .bin → the server signs + packs it (ota-signer.ts, ota_sign.py
	//      parity — requires FIRMWARE_SIGNING_KEY) with the AUTOMATIC
	//      anti-downgrade counter: max(catalog counter) + 1 (monotonic —
	//      never reused, never below a previous release; embedded policy).
	const isNinbus = input.artifactType === 'firmware-ninbus';
	// Monotonic catalog counter (firmware-ninbus only): the server-sign path
	// ALWAYS uses max+1; the factory-.tar path validates its embedded counter
	// against the same floor (strictly greater — see below). Includes drafts,
	// so a deleted draft's counter can not be silently re-signed.
	const [maxCounterRow] = isNinbus
		? await db
				.select({ maxCounter: sql<number>`coalesce(max(${firmwareReleases.counter}), 0)` })
				.from(firmwareReleases)
				.where(eq(firmwareReleases.artifactType, 'firmware-ninbus'))
		: [];
	const catalogMaxCounter = Number(maxCounterRow?.maxCounter ?? 0);
	const signCounter = isNinbus && !isTar ? catalogMaxCounter + 1 : null;
	validateFileSize(file.size);

	// Validate the canonical tar structure BEFORE any external call — a
	// malformed package must fail fast, never reach a device.
	let fileBuffer: Buffer = Buffer.from(await file.arrayBuffer());
	let tarInfo: Awaited<ReturnType<typeof validateCanonicalTar>> | null = null;
	if (signCounter !== null) {
		// Server-side pipeline: sign + pack, then validate our OWN output
		// (defense in depth — same validator the .tar path goes through).
		try {
			appLogger.info(
				'[FIRMWARE] Server-side signing: %s (%d KB) counter=%d version=%s → canonical tar v2',
				file.name,
				Math.round(fileBuffer.length / 1024),
				signCounter,
				input.version,
			);
			// v2 (version-piso): the typed version is packed into the manifest and
			// covered by the signature. STRICT X.Y.Z[.B] — suffixes must come via the
			// factory .tar (ota_sign.py --version) or a clean-version re-tag.
			fileBuffer = await buildNinbusTar(fileBuffer, signCounter, {
				version: packVersionString(input.version),
			});
			tarInfo = await validateCanonicalTar(fileBuffer, 'firmware-ninbus');
		} catch (e) {
			if (e instanceof OtaSignerError) {
				throw new FirmwareValidationError(e.message, e.code);
			}
			if (e instanceof InvalidPackageError) {
				throw new FirmwareValidationError(e.message, 'INVALID_PACKAGE');
			}
			throw e;
		}
	} else if (isTar) {
		try {
			tarInfo = await validateCanonicalTar(fileBuffer, input.artifactType as CanonicalArtifactType);
		} catch (e) {
			// Surface package-validation failures through the route's
			// FirmwareValidationError handling (400 with the validator message).
			if (e instanceof InvalidPackageError) {
				throw new FirmwareValidationError(e.message, 'INVALID_PACKAGE');
			}
			throw e;
		}
		if (isNinbus) {
			// Version CONFERÊNCIA (v2 contract): the signed manifest is the SOURCE
			// of truth — the typed version may only MATCH it, never override it.
			if (tarInfo.manifestFormat === 2 && tarInfo.versionText !== input.version) {
				throw new FirmwareValidationError(
					`Versão digitada (${input.version}) difere da versão ASSINADA no manifesto v2 (${tarInfo.versionText}). O manifesto é a fonte — re-uploade com a versão correta ou re-assine o .tar (ota_sign.py --version ${tarInfo.versionText}).`,
					'INVALID_VERSION',
				);
			}
			// Counter floor (anti-replay): a re-offered factory .tar must carry a
			// counter STRICTLY greater than the catalog max — devices burn the
			// served counter even on failed applies (bench: 660–664).
			if ((tarInfo.counter ?? 0) <= catalogMaxCounter) {
				throw new FirmwareValidationError(
					`Counter do manifesto (${tarInfo.counter}) deve ser ESTRITAMENTE maior que o máximo do catálogo (${catalogMaxCounter}) — o piso anti-replay dos devices não regride. Re-assine com ota_sign.py usando counter ≥ ${catalogMaxCounter + 1}.`,
					'INVALID_COUNTER',
				);
			}
		}
	}

	if (!hawkbitConfig.enabled) {
		throw new FirmwareValidationError(
			'Firmware operations require hawkBit to be enabled',
			'HAWKBIT_NOT_ENABLED',
		);
	}

	// UNIQUE (artifactType, version) — enforce BEFORE touching hawkBit so we
	// never orphan an SM for a release that can't be recorded.
	const [dupe] = await db
		.select({ id: firmwareReleases.id })
		.from(firmwareReleases)
		.where(
			and(
				eq(firmwareReleases.artifactType, input.artifactType),
				eq(firmwareReleases.version, input.version),
			),
		);
	if (dupe) {
		throw new FirmwareValidationError(
			`Version ${input.version} of ${input.artifactType} is already published (release ${dupe.id}). Version tags are unique per firmware type — publish a new version instead.`,
			'DUPLICATE_VERSION',
		);
	}

	appLogger.info(
		'[FIRMWARE] Uploading release: %s (%d KB) type=%s version=%s',
		file.name,
		Math.round(file.size / 1024),
		input.artifactType,
		input.version,
	);

	// firmware-ninbus: store the tool-generated tar VERBATIM (signed manifest
	// inside data/firmware.npm — the server never signs). Controller: .tar
	// verbatim or raw .fir packaged into the canonical format.
	let tarBlob: Blob;
	let tarFilename: string;
	let tarSize: number;
	let payloadBytes: number;
	if (isTar || signCounter !== null) {
		tarBlob = new Blob([fileBuffer], { type: 'application/x-tar' });
		tarFilename =
			signCounter !== null
				? file.name.replace(/\.[^.]+$/, '') + '.tar' // server-packaged from .bin
				: file.name;
		tarSize = fileBuffer.length;
		payloadBytes = tarInfo!.imageSize;
	} else {
		const packaged = await packageArtifact(file, input.artifactType);
		tarBlob = packaged.blob;
		tarFilename = packaged.filename;
		tarSize = packaged.size;
		payloadBytes = file.size;
	}

	const smType = await getOrCreateSoftwareModuleType(input.artifactType);
	const smUuid = randomUUID();
	const sm = await hawkbitSoftwareModules.create({
		name: `sm-${smUuid}`,
		version: input.version,
		type: smType.typeKey,
		description: [
			input.description ?? `Ninbus firmware release: ${input.artifactType}`,
			`releaseName: ${input.name}`,
			`originalFile: ${file.name}`,
			`payloadBytes: ${payloadBytes}`,
		].join(' | '),
	});

	appLogger.info('[FIRMWARE] Created SM %d (release: %s)', sm.id, input.name);

	const tarFile = new File([tarBlob], tarFilename, { type: 'application/x-tar' });
	const artifact = await hawkbitSoftwareModules.uploadArtifact(sm.id, tarFile);

	const [release] = await db
		.insert(firmwareReleases)
		.values({
			hawkbitSmId: sm.id,
			name: input.name,
			version: input.version,
			artifactType: input.artifactType,
			description: input.description ?? null,
			originalFilename: file.name,
			payloadSize: payloadBytes,
			packageSize: tarSize,
			// ninbus: signed counter (server path) or the manifest counter (.tar)
			counter: signCounter ?? tarInfo?.counter ?? null,
			manifestVersion: tarInfo?.versionPacked ?? null,
			manifestFlags: tarInfo && tarInfo.allowDowngrade !== null ? (tarInfo.allowDowngrade ? 0x1 : 0x0) : null,
			createdBy: userId,
		})
		.returning();

	if (!release) {
		throw new FirmwareValidationError(
			'Failed to record the firmware release (database error)',
			'NOT_FOUND',
		);
	}

	appLogger.info(
		'[FIRMWARE] Release %s published: %s v%s (SM %d, artifact #%s)',
		release.id,
		input.name,
		input.version,
		sm.id,
		artifact.id,
	);

	return {
		releaseId: release.id,
		smId: sm.id,
		artifactId: artifact.id,
		name: release.name,
		version: release.version,
		type: release.artifactType,
		size: tarSize,
		payloadSize: payloadBytes,
	};
}

// ---------------------------------------------------------------------------
// Reads (DB-only)
// ---------------------------------------------------------------------------

/** List releases, newest first (chronological DESC per the dashboard list). */
export async function listFirmwareReleases(params?: { type?: string }) {
	const rows = await db
		.select()
		.from(firmwareReleases)
		.where(params?.type ? eq(firmwareReleases.artifactType, params.type) : undefined)
		.orderBy(desc(firmwareReleases.createdAt));
	return { data: rows, total: rows.length };
}

/**
 * Latest release of a type — highest semver, tie-broken by recency.
 *
 * publishedOnly=true (default): the end-user view — drafts are invisible to
 * the mobile status endpoint and to the opt-in trigger. The admin console
 * passes false (or an explicit releaseId) to push drafts to pilot devices.
 */
export async function getLatestRelease(type: string, publishedOnly = true) {
	const rows = await db
		.select()
		.from(firmwareReleases)
		.where(
			and(
				eq(firmwareReleases.artifactType, type),
				publishedOnly ? eq(firmwareReleases.status, 'published') : undefined,
			),
		)
		.orderBy(desc(firmwareReleases.createdAt));
	if (rows.length === 0) return null;
	return rows.reduce((latest, r) => (compareVersions(r.version, latest.version) > 0 ? r : latest));
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Delete a release — catalog × history semantics.
 *
 * hawkBit 1.0.3 locks a Software Module FOREVER once it is part of a
 * Distribution Set assigned to targets (deployment audit trail — cancelling
 * the action does not unlock it). So:
 *
 * - not yet deployed → full delete (hawkBit SM + local row);
 * - locked (deployed) → the local catalog row is ALWAYS removed; the binary
 *   stays on hawkBit as history and the response warns about it
 *   (hawkbitKept: true).
 */
export async function deleteFirmwareRelease(releaseId: string) {
	const [release] = await db
		.select()
		.from(firmwareReleases)
		.where(eq(firmwareReleases.id, releaseId));
	if (!release) {
		throw new FirmwareValidationError('Firmware release not found', 'NOT_FOUND');
	}

	// Anti-replay floor preservation (bootloader contract): the manifest
	// counter of a SERVED release is burned into every device that accepted
	// the apply — readback/trial failures and rollbacks do NOT give it back.
	// Deleting the catalog's sole holder of the max served counter would lower
	// the floor, making the next max+1 upload re-sign an already-burned
	// counter (guaranteed replay rejection). Block and point at the runbook.
	if (release.artifactType === 'firmware-ninbus' && release.counter != null) {
		const [served] = await db
			.select({ id: deployments.id })
			.from(deployments)
			.where(
				and(
					eq(deployments.artifactType, 'firmware-ninbus'),
					eq(deployments.artifactVersion, release.version),
				),
			)
			.limit(1);
		if (served) {
			const [maxRow] = await db
				.select({ maxCounter: sql<number>`coalesce(max(${firmwareReleases.counter}), 0)` })
				.from(firmwareReleases)
				.where(eq(firmwareReleases.artifactType, 'firmware-ninbus'));
			if ((maxRow?.maxCounter ?? 0) === release.counter) {
				const [sameCounter] = await db
					.select({ n: sql<number>`count(*)` })
					.from(firmwareReleases)
					.where(
						and(
							eq(firmwareReleases.artifactType, 'firmware-ninbus'),
							eq(firmwareReleases.counter, release.counter),
							ne(firmwareReleases.id, releaseId),
						),
					);
				if (Number(sameCounter?.n ?? 0) === 0) {
					throw new FirmwareValidationError(
						`Release ${release.version} (counter ${release.counter}) was already SERVED to devices and is the catalog's sole holder of that counter. The bootloader anti-replay floor does not roll back — deleting it would make the next upload re-sign a burned counter (guaranteed replay rejection). Re-align the floor first: set counter=${release.counter} on an older release of the same type (or re-sign above it), then delete this one.`,
					'COUNTER_FLOOR_BURNED',
				);
				}
			}
		}
	}

	let hawkbitKept = false;
	try {
		await hawkbitSoftwareModules.delete(release.hawkbitSmId);
	} catch (error: any) {
		if (error?.status === 409 || error?.status === 423) {
			hawkbitKept = true;
		} else {
			throw error;
		}
	}

	await db.delete(firmwareReleases).where(eq(firmwareReleases.id, releaseId));
	appLogger.info(
		'[FIRMWARE] Release %s (%s v%s) deleted (hawkbitKept=%s)',
		releaseId,
		release.name,
		release.version,
		hawkbitKept,
	);
	return hawkbitKept
		? {
				message: `Release ${release.version} removed from the catalog. The binary remains on hawkBit as deployment history (it was already assigned to devices).`,
				hawkbitKept: true,
			}
		: { message: 'Firmware release deleted successfully', hawkbitKept: false };
}
