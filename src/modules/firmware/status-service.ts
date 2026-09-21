/**
 * Company Firmware Status — what the mobile app consults to know which
 * devices are outdated, plus the trigger that starts the update.
 *
 * Reads are DB-first: device versions come from `devices.firmwareVersion`
 * (synced from DDI attributes by the sync engine) and the "latest" comes from
 * the factory `firmware_releases` catalog. A rate-limited on-demand refresh
 * (refreshStaleFirmwareVersions) pulls hawkBit attributes for stale devices so
 * post-install reports are visible without waiting for the next sync cycle.
 */
import { appLogger } from '@common/logger';
import { hawkbitConfig } from '@common/config/hawkbit';
import { db } from '@common/db';
import { devices } from '@common/db/schema';
import { deployments } from '@common/db/schema';
import { hawkbitSoftwareModules } from '@common/hawkbit/client';
import { deploySoftwareModuleToTargets } from '@modules/deployments/deploy';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { getFirmwareReleaseById, runPublicationGate } from './release-gate';
import { compareVersions, getLatestRelease } from './service';
import { FirmwareValidationError } from './service';
import { refreshStaleFirmwareVersions } from './version-refresh';

export type DeviceFirmwareStatusValue =
	| 'up_to_date'
	| 'update_available'
	| 'unknown'
	| 'error'
	| 'no_release';

/** Classify one device against the latest release of its firmware type. */
export function classifyDeviceFirmware(
	deviceFirmwareVersion: string | null,
	hawkbitUpdateStatus: string | null,
	latestVersion: string | null,
): DeviceFirmwareStatusValue {
	if (!latestVersion) return 'no_release';
	if (hawkbitUpdateStatus === 'error') return 'error';
	if (!deviceFirmwareVersion) return 'unknown';
	return compareVersions(deviceFirmwareVersion, latestVersion) >= 0
		? 'up_to_date'
		: 'update_available';
}

/**
 * GET firmware status for a company:
 *  - latest factory releases (ninbus + controller)
 *  - every accepted device with its reported versions + computed status
 *  - summary counts (what the badge/donut shows)
 */
export async function getCompanyFirmwareStatus(companyId: string) {
	const [companyDevices, latestNinbus, latestController] = await Promise.all([
		db
			.select({
				id: devices.id,
				name: devices.name,
				serialDisplay: devices.serialDisplay,
				hawkbitTargetId: devices.hawkbitTargetId,
				firmwareVersion: devices.firmwareVersion,
				controllerFirmwareVersion: devices.controllerFirmwareVersion,
				connectionStatus: devices.connectionStatus,
				hawkbitUpdateStatus: devices.hawkbitUpdateStatus,
			})
			.from(devices)
			.where(and(eq(devices.companyId, companyId), eq(devices.status, 'accepted'))),
		getLatestRelease('firmware-ninbus'),
		getLatestRelease('firmware-controller'),
	]);

	const latestNinbusVersion = latestNinbus?.version ?? null;

	// Catch post-install reports the background sync may have missed (see
	// refreshStaleFirmwareVersions docs) — cheap, rate-limited, self-limiting.
	await refreshStaleFirmwareVersions(companyDevices, latestNinbusVersion);

	const rows = companyDevices.map((d) => ({
		deviceId: d.id,
		name: d.name,
		serialDisplay: d.serialDisplay,
		controllerId: d.hawkbitTargetId,
		firmwareVersion: d.firmwareVersion,
		controllerFirmwareVersion: d.controllerFirmwareVersion,
		connectionStatus: d.connectionStatus,
		hawkbitUpdateStatus: d.hawkbitUpdateStatus ?? null,
		firmwareStatus: classifyDeviceFirmware(
			d.firmwareVersion,
			d.hawkbitUpdateStatus ?? null,
			latestNinbusVersion,
		),
	}));

	const summary = rows.reduce(
		(acc, r) => {
			switch (r.firmwareStatus) {
				case 'up_to_date':
					acc.upToDate++;
					break;
				case 'update_available':
					acc.outdated++;
					break;
				case 'error':
					acc.error++;
					break;
				case 'unknown':
					acc.unknown++;
					break;
			}
			return acc;
		},
		{ total: rows.length, upToDate: 0, outdated: 0, unknown: 0, error: 0 },
	);

	return {
		latest: { ninbus: latestNinbus, controller: latestController },
		devices: rows,
		summary,
	};
}

/** Enrich device rows with the factory's latest firmware version + computed
 *  status. Used by the admin device views (list + company detail) so the
 *  factory sees who is on which version and who still needs updating. */
export async function enrichDevicesWithFirmwareStatus<
	T extends { firmwareVersion: string | null; hawkbitUpdateStatus: string | null },
>(
	rows: T[],
): Promise<
	(T & { latestFirmwareVersion: string | null; firmwareStatus: DeviceFirmwareStatusValue })[]
> {
	const latest = await getLatestRelease('firmware-ninbus');
	const latestVersion = latest?.version ?? null;
	await refreshStaleFirmwareVersions(rows, latestVersion);
	return rows.map((row) => ({
		...row,
		latestFirmwareVersion: latestVersion,
		firmwareStatus: classifyDeviceFirmware(
			row.firmwareVersion,
			row.hawkbitUpdateStatus,
			latestVersion,
		),
	}));
}

/**
 * POST firmware update — deploy the latest factory release of `artifactType`
 * to the selected devices. Reuses the shared deployment execution (DS creation,
 * force-close, assignment, DDI verification, local audit).
 */
export async function triggerFirmwareUpdate(
	companyId: string,
	userId: string,
	deviceIds: string[],
	artifactType: 'firmware-ninbus' | 'firmware-controller' = 'firmware-ninbus',
	opts?: { releaseId?: string; force?: boolean },
) {
	if (!hawkbitConfig.enabled) {
		throw new FirmwareValidationError(
			'Firmware operations require hawkBit to be enabled',
			'HAWKBIT_NOT_ENABLED',
		);
	}

	// Explicit releaseId (admin console testing) must STILL be published —
	// the OTA v2 contract: an assign never resolves a draft (bench 660–664:
	// four rollouts served the old PUBLISHED artifact while the new upload
	// sat in draft). The end-user trigger always resolves the latest PUBLISHED
	// release.
	const release = opts?.releaseId
		? await getFirmwareReleaseById(opts.releaseId)
		: await getLatestRelease(artifactType);
	if (!release) {
		throw new FirmwareValidationError(
			`No ${artifactType} release has been published yet. The factory must publish one first.`,
			'NOT_FOUND',
		);
	}
	if (release.artifactType !== artifactType) {
		throw new FirmwareValidationError(
			`Release ${release.version} is of type ${release.artifactType}, not ${artifactType}.`,
			'NOT_FOUND',
		);
	}
	// DRAFT + explicit releaseId = PILOT channel (admin console bench test):
	// the documented factory workflow — validate on assigned pilot devices
	// BEFORE publishing to the whole fleet. Guarded by the STRUCTURAL gate
	// (artifact re-download + tar integrity + v2 version match) so a corrupt
	// or mistyped artifact never reaches even a bench device; the official
	// rollout semantics (counter-vs-published, fleet floor) stay publish-only.
	// The DEFAULT path (no releaseId) still resolves PUBLISHED only — the
	// silent-stale-artifact hole of 660–664 remains closed.
	let draftPilot: string | undefined;
	if (release.status !== 'published') {
		const gate = await runPublicationGate(release.id, 'pilot');
		if (!gate.passed) {
			const failed = gate.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`);
			throw new FirmwareValidationError(
				`Pilot gate FAILED for draft ${release.version} — ${failed.join(' | ')}`,
				'GATE_FAILED',
			);
		}
		draftPilot =
			`PILOT: draft ${release.version} deployed to assigned test devices only — NOT published; companies will not see it until the publication gate passes.`;
		appLogger.warn('[FIRMWARE] %s', draftPilot);
	}

	// Anti re-offer (OTA v2 contract): when the LATEST deployment of this
	// artifact type ended with every target in 'error' AND it served THIS
	// release's version, the artifact was rejected by the devices (anti-replay
	// / readback). Re-offering the same binary just burns polls — block it
	// until a NEWER published release exists (re-signing bumps the version
	// because (type, version) is unique and served releases can't be deleted
	// below the counter floor).
	const [lastDeploy] = await db
		.select({
			id: deployments.id,
			artifactVersion: deployments.artifactVersion,
			createdAt: deployments.createdAt,
			snapshot: deployments.targetStatusSnapshot,
		})
		.from(deployments)
		.where(eq(deployments.artifactType, artifactType))
		.orderBy(desc(deployments.createdAt))
		.limit(1);
	if (
		lastDeploy &&
		lastDeploy.artifactVersion === release.version &&
		!opts?.force &&
		// Identity discriminator: only block when THIS release row predates the
		// failed deployment — i.e. it IS the artifact that was offered. A
		// re-uploaded same-version release (created AFTER the failure, carrying a
		// new counter) is the sanctioned v2 re-sign path (contract item 6).
		release.createdAt <= lastDeploy.createdAt
	) {
		const snap = lastDeploy.snapshot as Record<string, { phase?: string }> | null;
		const entries = snap ? Object.values(snap) : [];
		const anyError = entries.length > 0 && entries.every((e) => e.phase === 'error');
		if (anyError) {
			throw new FirmwareValidationError(
				`The latest ${artifactType} deployment served version ${release.version} and every target ended in ERROR — the devices rejected this artifact (anti-replay floor / readback). Re-offering the same binary will be rejected again: upload + publish a NEW release (higher version + counter), or retry with force=true if the failure was transient (e.g. devices offline).`,
				'REJECTED_ARTIFACT',
			);
		}
	}

	// Cross-tenant safe: only devices of THIS company, claimed, hawkBit-linked.
	const targets = await db
		.select({ id: devices.id, hawkbitTargetId: devices.hawkbitTargetId })
		.from(devices)
		.where(
			and(
				eq(devices.companyId, companyId),
				eq(devices.status, 'accepted'),
				isNotNull(devices.hawkbitTargetId),
				inArray(devices.id, deviceIds),
			),
		);

	if (targets.length === 0) {
		throw new FirmwareValidationError(
			'None of the given devices are eligible for update in this company.',
			'NOT_FOUND',
		);
	}

	// Resolve the SM fresh from hawkBit (validates it still exists).
	const sm = await hawkbitSoftwareModules.get(release.hawkbitSmId);

	// Operational guard: when the caller resolves the latest PUBLISHED release
	// but a NEWER DRAFT sits in the catalog, surface it instead of silently
	// shipping the old artifact (bench incident: rollout 660 served the 182 KB
	// debug build because the owner's 4.0.4 upload was still draft).
	let draftWarning: string | undefined;
	if (!opts?.releaseId) {
		const latestAny = await getLatestRelease(artifactType, false);
		if (
			latestAny &&
			latestAny.id !== release.id &&
			compareVersions(latestAny.version, release.version) > 0
		) {
			draftWarning =
				`Deployed PUBLISHED ${release.version}, but a NEWER DRAFT ${latestAny.version} ` +
				`(${latestAny.name}) exists in the catalog. Publish it if it should ship.`;
			appLogger.warn('[FIRMWARE] %s', draftWarning);
		}
	}

	const result = await deploySoftwareModuleToTargets(
		companyId,
		userId,
		{ id: sm.id, name: sm.name, version: sm.version },
		release.artifactType,
		`Firmware ${release.artifactType} ${release.version}`,
		targets.map((t) => t.hawkbitTargetId as string),
		{
			artifactName: `${release.name} (release ${release.version})`,
			artifactOriginalFile: release.originalFilename,
		},
	);
	const flags: Record<string, string> = {};
	if (draftWarning) flags['draftWarning'] = draftWarning;
	if (draftPilot) flags['draftPilot'] = draftPilot;
	return Object.keys(flags).length ? { ...result, ...flags } : result;
}
