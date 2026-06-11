/**
 * Sync Engine — Batch DB operations and on-demand sync.
 * Re-exports from split files for backward compatibility.
 */
import { hawkbitConfig } from '@common/config/hawkbit';
import { db } from '@common/db';
import { devices } from '@common/db/schema';
import { appLogger } from '@common/logger';
import { normalizeSerial } from '@common/utils/serial-number';
import { and, eq, isNotNull } from 'drizzle-orm';
import {
	type ConnectionStatus,
	type HawkbitUpdateStatus,
	extractTargetData,
	getProtectedStatus,
} from './sync-core';
import { fetchTargetsByIds } from './sync-fetch';
import { emitActionProgressEvents } from '@modules/deployments/sync-progress';

// Re-export everything from split files
export {
	type SyncState,
	type ConnectionStatus,
	type HawkbitUpdateStatus,
	extractTargetData,
	getProtectedStatus,
	mapUpdateStatus,
	protectTargetStatuses,
	syncSingleDeviceSwr,
} from './sync-core';
export {
	fetchAllHawkBitTargets,
	fetchModifiedTargets,
	fetchTargetsByIds,
} from './sync-fetch';

// ---------------------------------------------------------------------------
// Batch DB operations
// ---------------------------------------------------------------------------

export interface ChangedDevice {
	deviceId: string;
	companyId: string;
	controllerId: string;
	connectionStatus: string;
	hawkbitUpdateStatus: string;
	lastPollAt: Date | null;
	ipAddress: string | null;
}

/** Update local device records from hawkBit target data.
 *  Returns Map<companyId, count> of updated devices per company for SSE emission.
 */
export async function batchUpdateDevicesFromTargets(
	devicesToUpdate: { id: string; hawkbitTargetId: string; companyId?: string | null }[],
	targetMap: Map<string, any>,
): Promise<{ companyUpdates: Map<string, number>; changedDevices: ChangedDevice[] }> {
	if (devicesToUpdate.length === 0) return { companyUpdates: new Map(), changedDevices: [] };

	const companyUpdates = new Map<string, number>();
	const changedDevices: ChangedDevice[] = [];
	const now = new Date();

	// Batch updates in parallel (100 at a time to avoid DB overload)
	const chunkSize = 100;
	for (let i = 0; i < devicesToUpdate.length; i += chunkSize) {
		const chunk = devicesToUpdate.slice(i, i + chunkSize);
		const updates = chunk.map(async (device) => {
			const target = targetMap.get(device.hawkbitTargetId);
			if (!target) return;

			const targetData = extractTargetData(target);
			const protectedStatus = getProtectedStatus(device.hawkbitTargetId);
			if (protectedStatus) {
				targetData.hawkbitUpdateStatus = protectedStatus;
			}

			try {
				await db
					.update(devices)
					.set({ ...targetData, updatedAt: now })
					.where(eq(devices.id, device.id));

				if (device.companyId) {
					companyUpdates.set(device.companyId, (companyUpdates.get(device.companyId) ?? 0) + 1);
					changedDevices.push({
						deviceId: device.id,
						companyId: device.companyId,
						controllerId: device.hawkbitTargetId,
						connectionStatus: targetData.connectionStatus,
						hawkbitUpdateStatus: targetData.hawkbitUpdateStatus,
						lastPollAt: targetData.lastPollAt,
						ipAddress: targetData.ipAddress,
					});
				}
			} catch (error: any) {
				appLogger.debug('[SYNC] Failed to update device %s: %s', device.id, error?.message);
			}
		});
		await Promise.all(updates);
	}

	return { companyUpdates, changedDevices };
}

/** Auto-provision: create local devices for hawkBit targets not yet in DB. */
export async function syncNewTargets(targetMap: Map<string, any>): Promise<number> {
	const localDevices = await db.select({ hawkbitTargetId: devices.hawkbitTargetId }).from(devices);
	const localTargetIds = new Set(localDevices.map((d) => d.hawkbitTargetId).filter(Boolean));

	let created = 0;
	for (const [controllerId, target] of targetMap) {
		if (localTargetIds.has(controllerId)) continue;

		const normalized = normalizeSerial(controllerId);
		if (!normalized) continue;

		try {
			await db.insert(devices).values({
				companyId: null,
				hawkbitTargetId: controllerId,
				serialNumber: normalized.hex,
				serialDisplay: normalized.display,
				name: target.name || normalized.display,
				status: 'unclaimed',
				createdBy: null,
				...extractTargetData(target),
			});
			created++;
		} catch (error: any) {
			if (error?.code !== '23505') {
				appLogger.debug('[SYNC] Failed to create %s: %s', controllerId, error?.message);
			}
		}
	}

	if (created > 0) {
		appLogger.info('[SYNC] Created %d auto-provisioned device(s)', created);
	}
	return created;
}

/** Match pending devices against hawkBit targets. */
export async function syncPendingDevices(targetMap: Map<string, any>): Promise<void> {
	const localPending = await db.select().from(devices).where(eq(devices.status, 'pending'));
	if (localPending.length === 0) return;

	for (const local of localPending) {
		const match = local.serialNumber
			? targetMap.get(local.serialNumber) ?? targetMap.get(local.name)
			: null;

		if (match) {
			await db
				.update(devices)
				.set({
					hawkbitTargetId: match.controllerId,
					status: 'accepted',
					...extractTargetData(match),
					updatedAt: new Date(),
				})
				.where(eq(devices.id, local.id));

			appLogger.info('[SYNC] Linked pending device %s → hawkBit %s', local.name, match.controllerId);
		}
	}
}

// ---------------------------------------------------------------------------
// On-demand sync utilities
// ---------------------------------------------------------------------------

/** Company-scoped on-demand sync. Returns number of updated devices. */
export async function syncCompanyOnDemand(companyId: string): Promise<number> {
	if (!hawkbitConfig.enabled) return 0;

	const companyDevices = await db
		.select({ id: devices.id, hawkbitTargetId: devices.hawkbitTargetId, companyId: devices.companyId })
		.from(devices)
		.where(
			and(
				eq(devices.companyId, companyId),
				eq(devices.status, 'accepted'),
				isNotNull(devices.hawkbitTargetId),
			),
		);

	if (companyDevices.length === 0) return 0;

	const controllerIds = companyDevices
		.map((d) => d.hawkbitTargetId)
		.filter((id): id is string => id !== null);

	const targetMap = await fetchTargetsByIds(controllerIds);
	const { companyUpdates, changedDevices } = await batchUpdateDevicesFromTargets(companyDevices, targetMap);

	const count = companyUpdates.get(companyId) ?? 0;
	if (count > 0) {
		import('@common/sse').then(({ sseEmitter }) => {
			for (const d of changedDevices) {
				if (d.companyId === companyId) {
					sseEmitter.emit(companyId, 'device.status', {
						deviceId: d.deviceId,
						connectionStatus: d.connectionStatus,
						hawkbitUpdateStatus: d.hawkbitUpdateStatus,
						lastPollAt: d.lastPollAt?.toISOString() ?? null,
						ipAddress: d.ipAddress,
					});
				}
			}
			sseEmitter.emit(companyId, 'devices.batch', { count });
		});

		// Also poll detailed action progress for pending devices
		emitActionProgressEvents(changedDevices).catch((err) => {
			appLogger.debug('[SYNC] On-demand action progress poll failed: %s', err?.message);
		});
	}

	return count;
}
