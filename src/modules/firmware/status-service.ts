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
import { hawkbitConfig } from '@common/config/hawkbit';
import { db } from '@common/db';
import { devices } from '@common/db/schema';
import { hawkbitSoftwareModules, hawkbitTargets } from '@common/hawkbit/client';
import { deploySoftwareModuleToTargets } from '@modules/deployments/deploy';
import { extractFirmwareVersions } from '@modules/devices/firmware-sync';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { compareVersions, getLatestRelease } from './service';
import { FirmwareValidationError } from './service';

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

// ---------------------------------------------------------------------------
// On-demand version refresh
// ---------------------------------------------------------------------------

/** Per-device rate limit for on-demand attribute pulls (ms). */
const REFRESH_TTL_MS = 60_000;
const REFRESH_CONCURRENCY = 10;
const lastAttributePullAt = new Map<string, number>();

/**
 * Pull DDI-reported versions from hawkBit for devices whose local version is
 * stale relative to the latest release (or never reported).
 *
 * Why on-demand: the background sync only pulls attributes for devices with
 * `hawkbitUpdateStatus='pending'` or a NULL version. A device that just
 * finished installing transitions to 'in_sync' — potentially in the same
 * sync cycle, BEFORE its post-install configData report is pulled — leaving
 * the local version one release behind with no background path to catch up.
 *
 * Cost control: rate-limited to one pull per device per minute (in-memory),
 * and self-limiting — a device stops being eligible as soon as its reported
 * version reaches the latest release. Steady-state fleets (all up to date)
 * generate ZERO hawkBit calls.
 */
export async function refreshStaleFirmwareVersions<
	T extends {
		id?: string;
		hawkbitTargetId?: string | null;
		firmwareVersion: string | null;
		controllerFirmwareVersion?: string | null;
	},
>(rows: T[], latestVersion: string | null): Promise<void> {
	if (!hawkbitConfig.enabled || rows.length === 0) return;

	const now = Date.now();
	const eligible = rows.filter((r) => {
		if (!r.id || !r.hawkbitTargetId) return false;
		if (latestVersion && r.firmwareVersion && compareVersions(r.firmwareVersion, latestVersion) >= 0) {
			return false;
		}
		return now - (lastAttributePullAt.get(r.id) ?? 0) >= REFRESH_TTL_MS;
	});

	for (let i = 0; i < eligible.length; i += REFRESH_CONCURRENCY) {
		const batch = eligible.slice(i, i + REFRESH_CONCURRENCY);
		await Promise.all(
			batch.map(async (device) => {
				// Mark BEFORE fetching so a slow/failed fetch does not retry-storm.
				lastAttributePullAt.set(device.id!, Date.now());
				try {
					const attributes = await hawkbitTargets.getAttributes(device.hawkbitTargetId!);
					const versions = extractFirmwareVersions(attributes);
					if (!versions) return;
					if (
						versions.firmwareVersion === device.firmwareVersion &&
						versions.controllerFirmwareVersion === (device.controllerFirmwareVersion ?? null)
					) {
						return;
					}
					await db
						.update(devices)
						.set({ ...versions, updatedAt: new Date() })
						.where(eq(devices.id, device.id!));
					// Mutate the row so callers classify with the fresh values.
					device.firmwareVersion = versions.firmwareVersion;
					device.controllerFirmwareVersion = versions.controllerFirmwareVersion;
				} catch {
					// Best-effort: a failed pull keeps the last known version.
				}
			}),
		);
	}
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
) {
	if (!hawkbitConfig.enabled) {
		throw new FirmwareValidationError(
			'Firmware operations require hawkBit to be enabled',
			'HAWKBIT_NOT_ENABLED',
		);
	}

	const release = await getLatestRelease(artifactType);
	if (!release) {
		throw new FirmwareValidationError(
			`No ${artifactType} release has been published yet. The factory must publish one first.`,
			'NOT_FOUND',
		);
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

	return deploySoftwareModuleToTargets(
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
}
