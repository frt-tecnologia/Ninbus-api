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
import { firmwareReleases } from '@common/db/schema';
import {
	NINBUS_ARTIFACT_TYPES,
	getOrCreateSoftwareModuleType,
	hawkbitSoftwareModules,
} from '@common/hawkbit/client';
import { appLogger } from '@common/logger';
import { validateFileExtension, validateFileSize } from '@modules/artifacts/service';
import { packageArtifact } from '@modules/artifacts/tar-packager';
import { compareVersions } from './versioning';
import { and, desc, eq } from 'drizzle-orm';

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
			| 'INVALID_STATUS',
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
	validateFileExtension(file.name);
	validateFileSize(file.size);
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

	// Same device contract as artifacts: plain .tar with header-info + data/.
	const packaged = await packageArtifact(file, input.artifactType);

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
			`payloadBytes: ${file.size}`,
		].join(' | '),
	});

	appLogger.info('[FIRMWARE] Created SM %d (release: %s)', sm.id, input.name);

	const tarFile = new File([packaged.blob], packaged.filename, { type: 'application/x-tar' });
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
			payloadSize: file.size,
			packageSize: packaged.size,
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
		size: packaged.size,
		payloadSize: file.size,
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
