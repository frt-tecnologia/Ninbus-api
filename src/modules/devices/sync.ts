import { hawkbitConfig } from '@common/config/hawkbit';
import { db } from '@common/db';
import { devices } from '@common/db/schema';
import { hawkbitTargets } from '@common/hawkbit/client';
import { appLogger } from '@common/logger';
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
