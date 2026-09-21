import { db } from '@common/db';
import { devices, firmwareReleases } from '@common/db/schema';
import { appLogger } from '@common/logger';
import { createHash } from 'node:crypto';
import { and, eq, ne, sql } from 'drizzle-orm';
import { hawkbitConfig } from '@common/config/hawkbit';
import { hawkbitSoftwareModules } from '@common/hawkbit/client';
import { FirmwareValidationError } from './service';
import { compareVersions } from './versioning';
import { InvalidPackageError, validateCanonicalTar } from './tar-validator';

/** Per-check result recorded in the gate evidence (JSONB on the release). */
export interface GateCheck {
	name: string;
	passed: boolean;
	detail: string;
}

export interface PublicationGateResult {
	/** Verdict — publishing requires every check to pass. */
	passed: boolean;
	checkedAt: string;
	checks: GateCheck[];
	/** Evidence: recomputed image SHA-256 (hex). */
	imageSha256: string | null;
	/** Fleet floor at check time (max reported device firmware version). */
	fleetFloorVersion: string | null;
	catalogMaxCounter: number | null;
}

// ---------------------------------------------------------------------------
// Publish gate (draft <-> published)
// ---------------------------------------------------------------------------

/** Fetch one release by id (any status) — throws NOT_FOUND if absent. */
export async function getFirmwareReleaseById(releaseId: string) {
	const [release] = await db
		.select()
		.from(firmwareReleases)
		.where(eq(firmwareReleases.id, releaseId));
	if (!release) {
		throw new FirmwareValidationError('Firmware release not found', 'NOT_FOUND');
	}
	return release;
}

// ---------------------------------------------------------------------------
// Publication gate (OTA v2 contract) — run BEFORE status='published'
// ---------------------------------------------------------------------------

/**
 * Re-verify a release end-to-end from the ACTUAL hawkBit artifact — the
 * binary that will be served, not the uploaded file:
 *  (a) canonical tar integrity (re-download + full structural validation);
 *  (b) image SHA-256 recomputed and recorded as evidence;
 *  (c) v2 manifest with version == the release's declared version;
 *  (d) counter STRICTLY greater than the max PUBLISHED counter;
 *  (e) version strictly greater than the fleet floor (max reported device
 *      firmware version), unless the manifest carries allow_downgrade.
 * The verdict is persisted on the release (gate + gate_at) as evidence.
 */
export async function runPublicationGate(releaseId: string): Promise<PublicationGateResult> {
	const release = await getFirmwareReleaseById(releaseId);
	if (release.artifactType !== 'firmware-ninbus') {
		// Gate only applies to the signed self-update artifact.
		const result: PublicationGateResult = {
			passed: true,
			checkedAt: new Date().toISOString(),
			checks: [
				{
					name: 'artifact-type',
					passed: true,
					detail: `${release.artifactType}: publication gate applies to firmware-ninbus only.`,
				},
			],
			imageSha256: null,
			fleetFloorVersion: null,
			catalogMaxCounter: null,
		};
		await persistGate(releaseId, result);
		return result;
	}
	if (!hawkbitConfig.enabled) {
		throw new FirmwareValidationError(
			'The publication gate needs hawkBit to re-download the artifact.',
			'HAWKBIT_NOT_ENABLED',
		);
	}

	const checks: GateCheck[] = [];
	let imageSha256: string | null = null;

	// (a)+(b): re-download the artifact binary and re-validate the tar.
	let tarBuffer: Buffer;
	try {
		const artifacts = await hawkbitSoftwareModules.listArtifacts(release.hawkbitSmId);
		const art = artifacts[0];
		if (!art) throw new Error('SM has no artifacts');
		tarBuffer = Buffer.from(
			await hawkbitSoftwareModules.downloadArtifact(release.hawkbitSmId, art.id),
		);
	} catch (e: any) {
		const result: PublicationGateResult = {
			passed: false,
			checkedAt: new Date().toISOString(),
			checks: [
				{
					name: 'artifact-download',
					passed: false,
					detail: `failed to re-download the artifact from hawkBit: ${e?.message ?? e}`,
				},
			],
			imageSha256: null,
			fleetFloorVersion: null,
			catalogMaxCounter: null,
		};
		await persistGate(releaseId, result);
		return result;
	}

	let tarInfo: Awaited<ReturnType<typeof validateCanonicalTar>> | null = null;
	try {
		tarInfo = await validateCanonicalTar(tarBuffer, 'firmware-ninbus');
		checks.push({
			name: 'tar-integrity',
			passed: true,
			detail: `canonical tar re-validated from the served binary (${tarBuffer.length} B, image ${tarInfo.imageSize} B).`,
		});
	} catch (e) {
		const msg = e instanceof InvalidPackageError ? e.message : String(e);
		checks.push({ name: 'tar-integrity', passed: false, detail: msg });
	}

	if (tarInfo) {
		const image = tarBuffer.subarray(tarBuffer.length - tarInfo.imageSize);
		imageSha256 = createHash('sha256').update(image).digest('hex');
		checks.push({
			name: 'image-sha256',
			passed: true,
			detail: `recomputed image SHA-256: ${imageSha256}`,
		});
		// (c): v2 + version == declared.
		if (tarInfo.manifestFormat === 2) {
			const match = tarInfo.versionText === release.version;
			checks.push({
					name: 'manifest-v2-version',
					passed: match,
					detail: match
						? `manifest v2 version ${tarInfo.versionText} (0x${(tarInfo.versionPacked ?? 0).toString(16).padStart(8, '0')}) == declared ${release.version}`
						: `manifest v2 version ${tarInfo.versionText} != declared ${release.version}`,
				});
		} else {
			checks.push({
					name: 'manifest-v2-version',
					passed: false,
					detail: `legacy v1 manifest (no version-piso). The v2 contract requires new releases to be v2 — re-sign with ota_sign.py --version ${release.version} (counter ≥ ${(release.counter ?? 0) + 1}).`,
				});
		}
	}

	// (d): counter strictly greater than the max PUBLISHED counter (others).
	const [maxPub] = await db
		.select({ maxCounter: sql<number>`coalesce(max(${firmwareReleases.counter}), 0)` })
		.from(firmwareReleases)
		.where(
			and(
				eq(firmwareReleases.artifactType, 'firmware-ninbus'),
				eq(firmwareReleases.status, 'published'),
				ne(firmwareReleases.id, releaseId),
			),
		);
	const catalogMaxCounter = Number(maxPub?.maxCounter ?? 0);
	if (release.counter != null) {
		checks.push({
			name: 'counter-monotonic',
			passed: release.counter > catalogMaxCounter,
			detail: `release counter ${release.counter} vs max published ${catalogMaxCounter} — must be strictly greater.`,
		});
	} else {
		checks.push({
			name: 'counter-monotonic',
			passed: false,
			detail: 'release carries no manifest counter (pre-counter era row).',
		});
	}

	// (e): version > fleet floor, unless allow_downgrade is signed.
	const [fleet] = await db
		.select({ maxVersion: sql<string | null>`max(${devices.firmwareVersion})` })
		.from(devices);
	const fleetFloorVersion = fleet?.maxVersion ?? null;
	const allowDowngrade = ((release.manifestFlags ?? 0) & 0x1) === 0x1;
	if (fleetFloorVersion && !allowDowngrade) {
		const above = compareVersions(release.version, fleetFloorVersion) > 0;
		checks.push({
			name: 'fleet-version-floor',
				passed: above,
				detail: above
					? `declared ${release.version} > fleet floor ${fleetFloorVersion}`
					: `declared ${release.version} ≤ fleet floor ${fleetFloorVersion} — re-sign with a higher version or --allow-downgrade.`,
		});
	} else {
		checks.push({
			name: 'fleet-version-floor',
			passed: true,
			detail: allowDowngrade
				? 'allow_downgrade is signed (bit0) — floor check waived.'
				: 'no device reports a firmware version yet — nothing to floor against.',
		});
	}

	const result: PublicationGateResult = {
		passed: checks.every((c) => c.passed),
		checkedAt: new Date().toISOString(),
		checks,
		imageSha256,
		fleetFloorVersion,
		catalogMaxCounter,
	};
	await persistGate(releaseId, result);
	appLogger.info(
		'[FIRMWARE] Publication gate for %s (%s): %s',
		releaseId,
		release.version,
		result.passed ? 'PASSED' : 'FAILED',
	);
	return result;
}

async function persistGate(releaseId: string, result: PublicationGateResult) {
	await db
		.update(firmwareReleases)
		.set({ gate: result as any, gateAt: new Date(), updatedAt: new Date() })
		.where(eq(firmwareReleases.id, releaseId));
}

// ---------------------------------------------------------------------------
// Publish gate (draft ⇄ published)
// ---------------------------------------------------------------------------

/**
 * Publish / unpublish a release — the factory test gate.
 *
 * Publishing REQUIRES the OTA v2 publication gate to pass first: it runs
 * inline (artifact re-download, manifest v2 + version match, counter
 * monotonicity, fleet floor) and the verdict is persisted as evidence on
 * the release. Unpublishing is the emergency brake: the release disappears
 * from user-facing endpoints even though deployments already assigned to
 * devices keep running (hawkBit-side).
 */
export async function setFirmwareReleaseStatus(
	releaseId: string,
	status: 'draft' | 'published',
	opts?: { skipGate?: boolean },
) {
	const release = await getFirmwareReleaseById(releaseId);
	if (release.status === status) {
		throw new FirmwareValidationError(
			`Release ${release.version} is already ${status}.`,
			'INVALID_STATUS',
		);
	}
	if (status === 'published' && !opts?.skipGate) {
		const gate = await runPublicationGate(releaseId);
		if (!gate.passed) {
			const failed = gate.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`);
			throw new FirmwareValidationError(
				`Publication gate FAILED for ${release.version} — ${failed.join(' | ')}`,
				'GATE_FAILED',
			);
		}
	}
	const [updated] = await db
		.update(firmwareReleases)
		.set({ status, updatedAt: new Date() })
		.where(eq(firmwareReleases.id, releaseId))
		.returning();
	if (!updated) {
		throw new FirmwareValidationError('Firmware release not found', 'NOT_FOUND');
	}
	appLogger.info(
		'[FIRMWARE] Release %s (%s v%s) → %s',
		releaseId,
		release.name,
		release.version,
		status,
	);
	return updated;
}
