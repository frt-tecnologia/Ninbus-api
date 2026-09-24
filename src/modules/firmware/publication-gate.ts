/**
 * Publication gate — pre-publish verification of the SERVED artifact, with
 * evidence persisted on the release. Modes: 'publish' (full contract) |
 * 'pilot' (structural only, draft bench tests). Contract: SKILL.md § Firmware OTA.
 */
import { createHash } from 'node:crypto';
import { hawkbitConfig } from '@common/config/hawkbit';
import { db } from '@common/db';
import { devices, firmwareReleases } from '@common/db/schema';
import { hawkbitSoftwareModules } from '@common/hawkbit/client';
import { appLogger } from '@common/logger';
import { eq, sql } from 'drizzle-orm';
import { extractImageFromTar } from './artifact-download';
import { catalogCounterFloor, getFirmwareReleaseById } from './catalog';
import { FirmwareValidationError } from './errors';
import { InvalidPackageError, validateCanonicalTar } from './tar-validator';
import { compareVersions } from './versioning';

export interface GateCheck {
	name: string;
	passed: boolean;
	detail: string;
}

export interface PublicationGateResult {
	mode: 'publish' | 'pilot';
	passed: boolean;
	checkedAt: string;
	checks: GateCheck[];
	imageSha256: string | null;
	fleetFloorVersion: string | null;
	catalogMaxCounter: number | null;
}

export async function runPublicationGate(
	releaseId: string,
	mode: 'publish' | 'pilot' = 'publish',
): Promise<PublicationGateResult> {
	const release = await getFirmwareReleaseById(releaseId);
	if (release.artifactType !== 'firmware-ninbus') {
		return finish(releaseId, {
			mode,
			passed: true,
			checkedAt: now(),
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
		});
	}
	if (!hawkbitConfig.enabled) {
		throw new FirmwareValidationError(
			'The publication gate needs hawkBit to re-download the artifact.',
			'HAWKBIT_NOT_ENABLED',
		);
	}

	const checks: GateCheck[] = [];
	const tar = await reDownloadTar(release.hawkbitSmId);
	if (!tar) {
		return finish(releaseId, {
			mode,
			passed: false,
			checkedAt: now(),
			checks: [
				{
					name: 'artifact-download',
					passed: false,
					detail: 'failed to re-download the artifact from hawkBit',
				},
			],
			imageSha256: null,
			fleetFloorVersion: null,
			catalogMaxCounter: null,
		});
	}

	let imageSha256: string | null = null;
	let tarInfo: Awaited<ReturnType<typeof validateCanonicalTar>> | null = null;
	try {
		tarInfo = await validateCanonicalTar(tar, 'firmware-ninbus');
		checks.push({
			name: 'tar-integrity',
			passed: true,
			detail: `canonical tar re-validated from the served binary (${tar.length} B, image ${tarInfo.imageSize} B).`,
		});
	} catch (e) {
		checks.push({
			name: 'tar-integrity',
			passed: false,
			detail: e instanceof InvalidPackageError ? e.message : String(e),
		});
	}

	if (tarInfo) {
		// Image = tail of the data member (NOT of the whole file — the archive
		// ends with end-blocks/padding). extractImageFromTar re-validates.
		const { image } = await extractImageFromTar(tar, 'firmware-ninbus');
		imageSha256 = createHash('sha256').update(image).digest('hex');
		checks.push({
			name: 'image-sha256',
			passed: true,
			detail: `recomputed image SHA-256: ${imageSha256}`,
		});
		const match = tarInfo.manifestFormat === 2 && tarInfo.versionText === release.version;
		checks.push({
			name: 'manifest-v2-version',
			passed: match,
			detail:
				tarInfo.manifestFormat === 2
					? match
						? `manifest v2 version ${tarInfo.versionText} (0x${(tarInfo.versionPacked ?? 0).toString(16).padStart(8, '0')}) == declared ${release.version}`
						: `manifest v2 version ${tarInfo.versionText} != declared ${release.version}`
					: `legacy v1 manifest (no version-piso). The v2 contract requires new releases to be v2 — re-sign with ota_sign.py --version ${release.version} (counter ≥ ${(release.counter ?? 0) + 1}).`,
		});
	}

	// PILOT mode: compare against the catalog floor EXCLUDING this release
	// (drafts included) — i.e. not below anything a device may have been
	// offered. Never compare the release against itself (2 > 2 = false).
	const pilotFloor =
		mode === 'pilot'
			? await catalogCounterFloor('firmware-ninbus', { excludeId: releaseId })
			: null;
	const catalogMaxCounter =
		pilotFloor ??
		(await catalogCounterFloor('firmware-ninbus', { excludeId: releaseId, publishedOnly: true }));
	const counterLabel = pilotFloor !== null ? 'catalog floor (drafts incl.)' : 'max published';
	checks.push({
		name: 'counter-monotonic',
		passed: release.counter != null && release.counter > catalogMaxCounter,
		detail:
			release.counter != null
				? `release counter ${release.counter} vs ${counterLabel} ${catalogMaxCounter} — must be strictly greater.`
				: 'release carries no manifest counter (pre-counter era row).',
	});

	const fleetFloorVersion =
		mode === 'pilot'
			? null
			: await db
					.select({ maxVersion: sql<string | null>`max(${devices.firmwareVersion})` })
					.from(devices)
					.then(([row]) => row?.maxVersion ?? null);
	const allowDowngrade = ((release.manifestFlags ?? 0) & 0x1) === 0x1;
	checks.push({
		name: 'fleet-version-floor',
		passed:
			!fleetFloorVersion ||
			allowDowngrade ||
			compareVersions(release.version, fleetFloorVersion) > 0,
		detail: !fleetFloorVersion
			? 'no device reports a firmware version yet — nothing to floor against.'
			: allowDowngrade
				? 'allow_downgrade is signed (bit0) — floor check waived.'
				: compareVersions(release.version, fleetFloorVersion) > 0
					? `declared ${release.version} > fleet floor ${fleetFloorVersion}`
					: `declared ${release.version} ≤ fleet floor ${fleetFloorVersion} — re-sign with a higher version or --allow-downgrade.`,
	});

	return finish(releaseId, {
		mode,
		passed: checks.every((c) => c.passed),
		checkedAt: now(),
		checks,
		imageSha256,
		fleetFloorVersion,
		catalogMaxCounter,
	});
}

export async function setFirmwareReleaseStatus(releaseId: string, status: 'draft' | 'published') {
	const release = await getFirmwareReleaseById(releaseId);
	if (release.status === status) {
		throw new FirmwareValidationError(
			`Release ${release.version} is already ${status}.`,
			'INVALID_STATUS',
		);
	}
	if (status === 'published') {
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

async function reDownloadTar(smId: number): Promise<Buffer | null> {
	try {
		const artifacts = await hawkbitSoftwareModules.listArtifacts(smId);
		const art = artifacts[0];
		if (!art) return null;
		return Buffer.from(await hawkbitSoftwareModules.downloadArtifact(smId, art.id));
	} catch {
		return null;
	}
}

async function finish(releaseId: string, result: PublicationGateResult) {
	await db
		.update(firmwareReleases)
		.set({ gate: result, gateAt: new Date(), updatedAt: new Date() })
		.where(eq(firmwareReleases.id, releaseId));
	appLogger.info(
		'[FIRMWARE] Publication gate (%s) for %s: %s',
		result.mode,
		releaseId,
		result.passed ? 'PASSED' : 'FAILED',
	);
	return result;
}

function now() {
	return new Date().toISOString();
}
