/**
 * Firmware version sync — pulls DDI-reported firmware versions from hawkBit
 * target attributes into the local `devices` table.
 *
 * DDI contract (device side — see docs/firmware-release-flow.md):
 *   PUT /{tenant}/controller/v1/{controllerId}/configData
 *   { "mode": "merge",
 *     "data": { "fw.ninbus.version": "4.0.1", "fw.controller.version": "1.2.0" } }
 * hawkBit persists those as target attributes; the Management API exposes
 * them via GET /rest/v1/targets/{controllerId}/attributes (one call per
 * target — the list endpoint does NOT embed attributes).
 *
 * Cost control: only devices that can actually learn something are polled —
 *  - hawkbitUpdateStatus='pending' → a deployment just (re)installed firmware
 *  - firmware_version IS NULL      → the device never reported a version yet
 * (one-shot per new device; steady-state fleets generate ZERO extra calls).
 */
import { hawkbitConfig } from '@common/config/hawkbit';
import { db } from '@common/db';
import { devices } from '@common/db/schema';
import { hawkbitTargets } from '@common/hawkbit/client';
import { appLogger } from '@common/logger';
import { and, eq, isNull, or, sql } from 'drizzle-orm';

/** DDI attribute keys the device firmware is expected to report. */
export const FW_ATTRIBUTE_KEYS = {
	ninbus: 'fw.ninbus.version',
	controller: 'fw.controller.version',
} as const;

/** Extract firmware versions from a hawkBit target attribute map (pure). */
export function extractFirmwareVersions(
	attributes: Record<string, string>,
): { firmwareVersion: string | null; controllerFirmwareVersion: string | null } | null {
	const firmwareVersion = attributes[FW_ATTRIBUTE_KEYS.ninbus] ?? null;
	const controllerFirmwareVersion = attributes[FW_ATTRIBUTE_KEYS.controller] ?? null;
	if (!firmwareVersion && !controllerFirmwareVersion) return null;
	return { firmwareVersion, controllerFirmwareVersion };
}

/** Max concurrent attribute fetches (matches the sync engine's batch size). */
const CONCURRENCY = 10;

/** Pull firmware versions for eligible devices. Returns rows updated. */
export async function syncFirmwareVersions(): Promise<number> {
	if (!hawkbitConfig.enabled) return 0;

	// Eligible: deploying right now OR never reported a version.
	const eligible = await db
		.select({
			id: devices.id,
			hawkbitTargetId: devices.hawkbitTargetId,
			firmwareVersion: devices.firmwareVersion,
			controllerFirmwareVersion: devices.controllerFirmwareVersion,
		})
		.from(devices)
		.where(
			and(
				sql`${devices.hawkbitTargetId} IS NOT NULL`,
				or(eq(devices.hawkbitUpdateStatus, 'pending'), isNull(devices.firmwareVersion)),
			),
		)
		.limit(500);

	if (eligible.length === 0) return 0;

	let updated = 0;
	for (let i = 0; i < eligible.length; i += CONCURRENCY) {
		const batch = eligible.slice(i, i + CONCURRENCY);
		await Promise.all(
			batch.map(async (device) => {
				try {
					const attributes = await hawkbitTargets.getAttributes(device.hawkbitTargetId!);
					const versions = extractFirmwareVersions(attributes);
					if (!versions) return;
					// Write only when something actually changed (steady state = no writes).
					if (
						versions.firmwareVersion === device.firmwareVersion &&
						versions.controllerFirmwareVersion === device.controllerFirmwareVersion
					) {
						return;
					}
					await db
						.update(devices)
						.set({ ...versions, updatedAt: new Date() })
						.where(eq(devices.id, device.id));
					updated++;
				} catch (error: any) {
					appLogger.debug(
						'[SYNC] Firmware attributes fetch failed for %s: %s',
						device.hawkbitTargetId,
						error?.message,
					);
				}
			}),
		);
	}

	if (updated > 0) {
		appLogger.info('[SYNC] Firmware versions updated for %d device(s)', updated);
	}
	return updated;
}
