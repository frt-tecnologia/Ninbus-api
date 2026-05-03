import { menderConfig } from '@common/config/mender';
import { db } from '@common/db';
import { devices } from '@common/db/schema';
import { appLogger } from '@common/logger';
import { menderDeviceAuth } from '@common/mender/client';
import { and, eq } from 'drizzle-orm';

/**
 * Centralized Synchronization Engine for Mender <-> Ninbus.
 *
 * This service handles:
 * 1. Auto-acceptance of pending devices by serial number.
 * 2. Syncing status and connection states (online/offline).
 * 3. Linking local Ninbus devices with Mender IDs.
 */
export const DeviceSyncEngine = {
	/**
	 * Fully synchronizes all devices for a specific company.
	 * Use this in list/detail routes to ensure data freshness.
	 */
	async syncCompany(companyId: string) {
		if (!menderConfig.enabled) return;
		appLogger.debug(`[SYNC] Starting full sync for company ${companyId}`);

		// 1. Process pending devices (Auto-accept)
		await this.autoAcceptPending(companyId);

		// 2. Update status for accepted devices
		await this.syncAcceptedStatus(companyId);
	},

	/**
	 * Finds devices in Mender that match local 'pending' registry by Serial Number.
	 */
	async autoAcceptPending(companyId: string) {
		const localPending = await db
			.select()
			.from(devices)
			.where(and(eq(devices.companyId, companyId), eq(devices.status, 'pending')));

		if (localPending.length === 0) return;

		const menderPending = await menderDeviceAuth.listDevices({ status: 'pending' });
		if (menderPending.length === 0) return;

		for (const local of localPending) {
			if (!local.serialNumber) continue;

			const match = menderPending.find((m) => m.identity_data?.['serial'] === local.serialNumber);
			if (match) {
				const pendingAuth = match.auth_sets?.find((a) => a.status === 'pending');
				if (pendingAuth) {
					try {
						await menderDeviceAuth.setAuthStatus(match.id, pendingAuth.id, 'accepted');
						await db
							.update(devices)
							.set({
								menderDeviceId: match.id,
								status: 'accepted',
								updatedAt: new Date(),
							})
							.where(eq(devices.id, local.id));

						appLogger.info(`[SYNC] Auto-accepted ${local.name} (${local.serialNumber})`);
					} catch (err) {
						appLogger.error({ msg: `[SYNC] Failed to accept ${local.name}`, error: err });
					}
				}
			}
		}
	},

	/**
	 * Updates connection status and 'last seen' for all accepted devices.
	 * Uses Mender Device Auth list for efficient batch updates.
	 */
	async syncAcceptedStatus(companyId: string) {
		const localAccepted = await db
			.select()
			.from(devices)
			.where(and(eq(devices.companyId, companyId), eq(devices.status, 'accepted')));

		if (localAccepted.length === 0) return;

		// 1. Get all accepted devices from Mender to get 'updated_ts' (last check-in)
		const menderAccepted = await menderDeviceAuth.listDevices({ status: 'accepted' });

		for (const local of localAccepted) {
			if (!local.menderDeviceId) continue;

			const mMatch = menderAccepted.find((m) => m.id === local.menderDeviceId);
			if (!mMatch) continue;

			try {
				// Determine best 'last seen' date
				// Priority: updated_ts from DevAuth (last check-in)
				const lastSeen = mMatch.updated_ts ? new Date(mMatch.updated_ts) : local.lastSeenAt;

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
	 * Approves/Accepts a device in Mender and updates local status.
	 */
	async acceptDevice(deviceId: string, menderDeviceId: string, authId: string) {
		try {
			await menderDeviceAuth.setAuthStatus(menderDeviceId, authId, 'accepted');
			await db
				.update(devices)
				.set({ status: 'accepted', updatedAt: new Date() })
				.where(eq(devices.id, deviceId));
			appLogger.info(`[SYNC] Device ${deviceId} accepted in Mender.`);
		} catch (err) {
			appLogger.error({ msg: `[SYNC] Failed to accept device ${deviceId}`, error: err });
			throw err;
		}
	},

	/**
	 * Rejects a device in Mender and updates local status.
	 */
	async rejectDevice(deviceId: string, menderDeviceId: string, authId: string) {
		try {
			await menderDeviceAuth.setAuthStatus(menderDeviceId, authId, 'rejected');
			await db
				.update(devices)
				.set({ status: 'rejected', updatedAt: new Date() })
				.where(eq(devices.id, deviceId));
			appLogger.info(`[SYNC] Device ${deviceId} rejected in Mender.`);
		} catch (_err) {
			appLogger.error({ msg: `[SYNC] Failed to reject device ${deviceId}`, error: _err });
			throw _err;
		}
	},

	/**
	 * Decommissions a device in Mender.
	 * This is the "hard reset" for a device, allowing it to be reused.
	 */
	async decommissionDevice(menderDeviceId: string) {
		try {
			await menderDeviceAuth.decommission(menderDeviceId);
			// Local update is usually handled by the caller (deletion or status update)
			appLogger.info(`[SYNC] Device ${menderDeviceId} decommissioned from Mender.`);
		} catch (_err) {
			// If device already gone from Mender, ignore error
			appLogger.debug(`[SYNC] Decommission failed or already gone for ${menderDeviceId}`);
		}
	},
};
