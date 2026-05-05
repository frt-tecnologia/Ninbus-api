import { hawkbitConfig } from '@common/config/hawkbit';
import { db } from '@common/db';
import { devices } from '@common/db/schema';
import { hawkbitTargets } from '@common/hawkbit/client';
import { appLogger } from '@common/logger';
import { and, eq } from 'drizzle-orm';

/**
 * Centralized Synchronization Engine for hawkBit <-> Ninbus.
 *
 * This service handles:
 * 1. Syncing targets from hawkBit to local registry.
 * 2. Updating status and connection states (online/offline via pollStatus).
 * 3. Linking local Ninbus devices with hawkBit target IDs.
 */
export const DeviceSyncEngine = {
	/**
	 * Fully synchronizes all devices for a specific company.
	 * Use this in list/detail routes to ensure data freshness.
	 */
	async syncCompany(companyId: string) {
		if (!hawkbitConfig.enabled) return;
		appLogger.debug(`[SYNC] Starting full sync for company ${companyId}`);

		// 1. Process pending devices (match by serial number in hawkBit)
		await this.syncPendingDevices(companyId);

		// 2. Update status for accepted devices
		await this.syncAcceptedStatus(companyId);
	},

	/**
	 * Finds targets in hawkBit that match local 'pending' registry by controller ID or serial number.
	 */
	async syncPendingDevices(companyId: string) {
		const localPending = await db
			.select()
			.from(devices)
			.where(and(eq(devices.companyId, companyId), eq(devices.status, 'pending')));

		if (localPending.length === 0) return;

		// Get all targets from hawkBit
		const hawkbitResponse = await hawkbitTargets.list({ limit: 1000 });
		const hawkbitTargetsList = hawkbitResponse.content;

		if (hawkbitTargetsList.length === 0) return;

		for (const local of localPending) {
			// Try to match by serial number in target name or controllerId
			const match = local.serialNumber
				? hawkbitTargetsList.find(
						(t) =>
							t.controllerId === local.serialNumber ||
							t.name === local.serialNumber ||
							t.controllerId === local.name,
					)
				: null;

			if (match) {
				try {
					await db
						.update(devices)
						.set({
							hawkbitTargetId: match.controllerId,
							status: 'accepted',
							updatedAt: new Date(),
						})
						.where(eq(devices.id, local.id));

					appLogger.info(`[SYNC] Linked ${local.name} to hawkBit target ${match.controllerId}`);
				} catch (err) {
					appLogger.error({ msg: `[SYNC] Failed to link ${local.name}`, error: err });
				}
			}
		}
	},

	/**
	 * Updates connection status and 'last seen' for all accepted devices.
	 */
	async syncAcceptedStatus(companyId: string) {
		const localAccepted = await db
			.select()
			.from(devices)
			.where(and(eq(devices.companyId, companyId), eq(devices.status, 'accepted')));

		if (localAccepted.length === 0) return;

		for (const local of localAccepted) {
			if (!local.hawkbitTargetId) continue;

			try {
				const target = await hawkbitTargets.get(local.hawkbitTargetId);

				// Determine best 'last seen' date from pollStatus
				const lastSeen = target.pollStatus?.lastRequestAt
					? new Date(target.pollStatus.lastRequestAt)
					: target.lastControllerRequestAt
						? new Date(target.lastControllerRequestAt)
						: local.lastSeenAt;

				await db
					.update(devices)
					.set({
						lastSeenAt: lastSeen,
						updatedAt: new Date(),
					})
					.where(eq(devices.id, local.id));
			} catch (_err) {
				appLogger.debug(`[SYNC] Failed to update local state for ${local.name}`);
			}
		}
	},

	/**
	 * Removes a target from hawkBit.
	 */
	async deleteTarget(targetId: string) {
		try {
			await hawkbitTargets.delete(targetId);
			appLogger.info(`[SYNC] Target ${targetId} deleted from hawkBit.`);
		} catch (_err) {
			appLogger.debug(`[SYNC] Delete failed or already gone for ${targetId}`);
		}
	},
};
