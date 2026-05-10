import { hawkbitConfig } from '@common/config/hawkbit';
import { db } from '@common/db';
import { devices } from '@common/db/schema';
import { hawkbitTargets } from '@common/hawkbit/client';
import { appLogger } from '@common/logger';
import { normalizeSerial } from '@common/utils/serial-number';
import { and, eq } from 'drizzle-orm';

/**
 * Sync Engine for hawkBit ↔ Ninbus.
 *
 * hawkBit simplifies the Mender model:
 * - No approval flow (targets created directly)
 * - No separate inventory API (attributes on target)
 * - No separate connection API (pollStatus on target)
 * - No check-update (hawkBit manages polling)
 */
export const DeviceSyncEngine = {
	/**
	 * Discover auto-provisioned targets in hawkBit that don't exist in the local DB.
	 * hawkBit auto-provisioning creates targets when a device polls for the first time,
	 * but the Ninbus API doesn't know about them until this sync runs.
	 *
	 * Creates local device entries with status='unclaimed' for each new target found.
	 * Returns the number of new devices discovered.
	 */
	async discoverAutoProvisioned(): Promise<number> {
		if (!hawkbitConfig.enabled) return 0;

		// 1. Get all targets from hawkBit
		const hawkbitResponse = await hawkbitTargets.list({ limit: 1000 });
		const hawkbitTargets_list = hawkbitResponse.content;
		if (hawkbitTargets_list.length === 0) return 0;

		// 2. Get all local device hawkbitTargetIds
		const localDevices = await db.select({ hawkbitTargetId: devices.hawkbitTargetId }).from(devices);
		const localTargetIds = new Set(localDevices.map((d) => d.hawkbitTargetId).filter(Boolean));

		// 3. Find targets in hawkBit that don't exist locally
		const newTargets = hawkbitTargets_list.filter((t) => !localTargetIds.has(t.controllerId));

		if (newTargets.length === 0) return 0;

		appLogger.info(`[SYNC] Discovered ${newTargets.length} auto-provisioned target(s) in hawkBit`);

		// 4. Create local device entries for each new target
		let created = 0;
		for (const target of newTargets) {
			const normalized = normalizeSerial(target.controllerId);
			if (!normalized) {
				appLogger.warn(`[SYNC] Skipping target ${target.controllerId} — not a valid hex serial`);
				continue;
			}

			try {
				await db.insert(devices).values({
					companyId: null,
					hawkbitTargetId: target.controllerId,
					serialNumber: normalized.hex,
					serialDisplay: normalized.display,
					name: target.name || normalized.display,
					status: 'unclaimed',
					createdBy: null, // auto-provisioned
				});
				created++;
				appLogger.info(`[SYNC] Created local device for auto-provisioned target ${target.controllerId}`);
			} catch (error: any) {
				// Race condition: might have been created by another process
				if (error?.code === '23505') {
					appLogger.debug(`[SYNC] Target ${target.controllerId} already exists locally`);
				} else {
					appLogger.error(`[SYNC] Failed to create device for ${target.controllerId}: ${error?.message}`);
				}
			}
		}

		return created;
	},

	async syncCompany(companyId: string) {
		if (!hawkbitConfig.enabled) return;
		appLogger.debug(`[SYNC] Syncing company ${companyId}`);
		await this.syncPendingDevices(companyId);
		await this.syncAcceptedStatus(companyId);
	},

	/** Match local pending devices to hawkBit targets by serial/name. */
	async syncPendingDevices(companyId: string) {
		const localPending = await db
			.select()
			.from(devices)
			.where(and(eq(devices.companyId, companyId), eq(devices.status, 'pending')));

		if (localPending.length === 0) return;

		const hawkbitResponse = await hawkbitTargets.list({ limit: 1000 });
		if (hawkbitResponse.content.length === 0) return;

		for (const local of localPending) {
			const match = local.serialNumber
				? hawkbitResponse.content.find(
						(t) =>
							t.controllerId === local.serialNumber ||
							t.name === local.serialNumber ||
							t.controllerId === local.name,
					)
				: null;

			if (match) {
				await db
					.update(devices)
					.set({
						hawkbitTargetId: match.controllerId,
						status: 'accepted',
						updatedAt: new Date(),
					})
					.where(eq(devices.id, local.id));

				appLogger.info(`[SYNC] Linked ${local.name} → hawkBit ${match.controllerId}`);
			}
		}
	},

	/** Update lastSeenAt from hawkBit pollStatus for accepted devices. */
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
				const lastSeen = target.pollStatus?.lastRequestAt
					? new Date(target.pollStatus.lastRequestAt)
					: local.lastSeenAt;

				await db
					.update(devices)
					.set({ lastSeenAt: lastSeen, updatedAt: new Date() })
					.where(eq(devices.id, local.id));
			} catch {
				appLogger.debug(`[SYNC] Failed for ${local.name}`);
			}
		}
	},

	/** Delete a target from hawkBit. */
	async deleteTarget(targetId: string) {
		try {
			await hawkbitTargets.delete(targetId);
			appLogger.info(`[SYNC] Target ${targetId} deleted from hawkBit`);
		} catch {
			appLogger.debug(`[SYNC] Delete failed for ${targetId}`);
		}
	},
};
