/**
 * Company firmware status — read-only view of device versions vs the factory
 * catalog (mobile status + admin enrichment). Trigger moved to deploy-trigger.
 */
import { db } from '@common/db';
import { devices } from '@common/db/schema';
import { and, eq } from 'drizzle-orm';
import { getLatestRelease } from './catalog';
import { refreshStaleFirmwareVersions } from './version-refresh';
import { compareVersions } from './versioning';

export type DeviceFirmwareStatusValue =
	| 'up_to_date'
	| 'update_available'
	| 'unknown'
	| 'error'
	| 'no_release';

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
