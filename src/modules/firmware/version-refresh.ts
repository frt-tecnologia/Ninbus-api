/**
 * On-demand firmware version refresh — pulls DDI-reported versions from
 * hawkBit target attributes for devices whose local version is stale
 * relative to the latest factory release (or never reported).
 *
 * Why on-demand: the background sync (devices/firmware-sync.ts) only pulls
 * attributes for devices with `hawkbitUpdateStatus='pending'` or a NULL
 * version. A device that just finished installing transitions to 'in_sync' —
 * potentially in the same sync cycle, BEFORE its post-install configData
 * report is pulled — leaving the local version one release behind with no
 * background path to catch up.
 *
 * Cost control: rate-limited to one pull per device per minute (in-memory),
 * and self-limiting — a device stops being eligible as soon as its reported
 * version reaches the latest release. Steady-state fleets (all up to date)
 * generate ZERO hawkBit calls.
 */
import { hawkbitConfig } from '@common/config/hawkbit';
import { db } from '@common/db';
import { devices } from '@common/db/schema';
import { hawkbitTargets } from '@common/hawkbit/client';
import { extractFirmwareVersions } from '@modules/devices/firmware-sync';
import { eq } from 'drizzle-orm';
import { compareVersions } from './versioning';

/** Per-device rate limit for on-demand attribute pulls (ms). */
const REFRESH_TTL_MS = 60_000;
const REFRESH_CONCURRENCY = 10;
const lastAttributePullAt = new Map<string, number>();

/** Mutates rows in place so callers classify with the fresh values. */
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
					device.firmwareVersion = versions.firmwareVersion;
					device.controllerFirmwareVersion = versions.controllerFirmwareVersion;
				} catch {
					// Best-effort: a failed pull keeps the last known version.
				}
			}),
		);
	}
}
