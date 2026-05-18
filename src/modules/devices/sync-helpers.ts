/**
 * Sync Engine for hawkBit ↔ Ninbus — Types, helpers, hawkBit fetch utilities.
 * Shared between all sync strategies.
 */
import { hawkbitConfig } from '@common/config/hawkbit';
import { db } from '@common/db';
import { devices } from '@common/db/schema';
import { hawkbitTargets } from '@common/hawkbit/client';
import { appLogger } from '@common/logger';
import { normalizeSerial } from '@common/utils/serial-number';
import { and, eq, isNotNull } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncState {
	lastFullSyncAt: Date | null;
	isRunning: boolean;
	totalSynced: number;
	lastDurationMs: number;
	errors: number;
	mode: 'periodic' | 'on_demand' | 'hybrid';
	lastIncrementalTimestamp: number | null;
}

export type ConnectionStatus = 'unknown' | 'connected' | 'disconnected';
export type HawkbitUpdateStatus = 'unknown' | 'in_sync' | 'pending' | 'registered' | 'error';

// ---------------------------------------------------------------------------
// Target data extraction
// ---------------------------------------------------------------------------

export function mapUpdateStatus(status: string | undefined): HawkbitUpdateStatus {
	if (!status) return 'unknown';
	const lower = status.toLowerCase();
	if (lower === 'in_sync') return 'in_sync';
	if (lower === 'pending') return 'pending';
	if (lower === 'registered') return 'registered';
	if (lower === 'error') return 'error';
	return 'unknown';
}

export function extractTargetData(target: {
	pollStatus?: { overdue?: boolean; lastRequestAt?: number; nextExpectedRequestAt?: number } | null;
	updateStatus?: string;
	ipAddress?: string | null;
}): {
	connectionStatus: ConnectionStatus;
	hawkbitUpdateStatus: HawkbitUpdateStatus;
	ipAddress: string | null;
	lastPollAt: Date | null;
	nextExpectedPollAt: Date | null;
	lastSeenAt: Date | null;
} {
	const isConnected = target.pollStatus ? !target.pollStatus.overdue : false;
	return {
		connectionStatus: isConnected ? 'connected' : 'disconnected',
		hawkbitUpdateStatus: mapUpdateStatus(target.updateStatus),
		ipAddress: target.ipAddress ?? null,
		lastPollAt: target.pollStatus?.lastRequestAt
			? new Date(target.pollStatus.lastRequestAt) : null,
		nextExpectedPollAt: target.pollStatus?.nextExpectedRequestAt
			? new Date(target.pollStatus.nextExpectedRequestAt) : null,
		lastSeenAt: target.pollStatus?.lastRequestAt
			? new Date(target.pollStatus.lastRequestAt) : null,
	};
}

// ---------------------------------------------------------------------------
// hawkBit fetch utilities
// ---------------------------------------------------------------------------

/** Fetch ALL hawkBit targets (paginated). */
export async function fetchAllHawkBitTargets(): Promise<Map<string, any>> {
	const targetMap = new Map<string, any>();
	const pageSize = 500;
	let offset = 0;
	let hasMore = true;

	while (hasMore) {
		const response = await hawkbitTargets.list({ offset, limit: pageSize });
		for (const target of response.content) {
			targetMap.set(target.controllerId, target);
		}
		offset += pageSize;
		hasMore = response.content.length === pageSize && offset < (response.total ?? 0);
	}

	return targetMap;
}

/** Fetch hawkBit targets modified since a timestamp (incremental sync). */
export async function fetchModifiedTargets(sinceTimestamp: number): Promise<Map<string, any>> {
	const targetMap = new Map<string, any>();
	const pageSize = 500;
	let offset = 0;
	let hasMore = true;
	const q = `lastModifiedAt>${sinceTimestamp}`;

	while (hasMore) {
		const response = await hawkbitTargets.list({ offset, limit: pageSize, q });
		for (const target of response.content) {
			targetMap.set(target.controllerId, target);
		}
		offset += pageSize;
		hasMore = response.content.length === pageSize && offset < (response.total ?? 0);
	}

	return targetMap;
}

/** Fetch hawkBit targets by controllerId list (company-scoped). */
export async function fetchTargetsByIds(controllerIds: string[]): Promise<Map<string, any>> {
	if (controllerIds.length === 0) return new Map();

	const targetMap = new Map<string, any>();
	const batchSize = 100; // hawkBit RSQL URL length limits

	for (let i = 0; i < controllerIds.length; i += batchSize) {
		const batch = controllerIds.slice(i, i + batchSize);
		const q = `controllerId=in=(${batch.join(',')})`;
		const response = await hawkbitTargets.list({ limit: batchSize, q });
		for (const target of response.content) {
			targetMap.set(target.controllerId, target);
		}
	}

	return targetMap;
}

// ---------------------------------------------------------------------------
// Batch DB operations
// ---------------------------------------------------------------------------

/** Update local device records from hawkBit target data.
 *  Returns Map<companyId, count> of updated devices per company for SSE emission.
 */
export async function batchUpdateDevicesFromTargets(
	devicesToUpdate: { id: string; hawkbitTargetId: string; companyId?: string | null }[],
	targetMap: Map<string, any>,
): Promise<{ companyUpdates: Map<string, number>; changedDevices: { deviceId: string; companyId: string; controllerId: string; connectionStatus: string; hawkbitUpdateStatus: string; lastPollAt: Date | null; ipAddress: string | null }[] }> {
	if (devicesToUpdate.length === 0) return { companyUpdates: new Map(), changedDevices: [] };

	const companyUpdates = new Map<string, number>();
	const changedDevices: { deviceId: string; companyId: string; controllerId: string; connectionStatus: string; hawkbitUpdateStatus: string; lastPollAt: Date | null; ipAddress: string | null }[] = [];
	let updated = 0;
	const now = new Date();
	const chunkSize = 100;

	for (let i = 0; i < devicesToUpdate.length; i += chunkSize) {
		const chunk = devicesToUpdate.slice(i, i + chunkSize);
		for (const device of chunk) {
			const target = targetMap.get(device.hawkbitTargetId);
			if (!target) continue;

			const targetData = extractTargetData(target);

			try {
				await db
					.update(devices)
					.set({ ...targetData, updatedAt: now })
					.where(eq(devices.id, device.id));
				updated++;

				// Track per-company counts and changed device data for SSE
				if (device.companyId) {
					companyUpdates.set(
						device.companyId,
						(companyUpdates.get(device.companyId) ?? 0) + 1,
					);
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
				appLogger.debug(`[SYNC] Failed to update device ${device.id}: ${error?.message}`);
			}
		}
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
				appLogger.debug(`[SYNC] Failed to create ${controllerId}: ${error?.message}`);
			}
		}
	}

	if (created > 0) {
		appLogger.info(`[SYNC] Created ${created} auto-provisioned device(s)`);
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

			appLogger.info(`[SYNC] Linked pending device ${local.name} → hawkBit ${match.controllerId}`);
		}
	}
}

// ---------------------------------------------------------------------------
// On-demand sync utilities
// ---------------------------------------------------------------------------

/** Single-device stale-while-revalidate sync. */
export async function syncSingleDeviceSwr(targetId: string): Promise<{
	updateStatus: string; connectionStatus: string; lastSeen: string | null; ipAddress: string | null;
} | null> {
	if (!hawkbitConfig.enabled) return null;

	const staleMs = hawkbitConfig.syncStaleSec * 1000;
	const [device] = await db
		.select({ updatedAt: devices.updatedAt })
		.from(devices)
		.where(eq(devices.hawkbitTargetId, targetId));

	if (device?.updatedAt && Date.now() - device.updatedAt.getTime() < staleMs) {
		const [fresh] = await db
			.select({
				hawkbitUpdateStatus: devices.hawkbitUpdateStatus,
				connectionStatus: devices.connectionStatus,
				lastSeenAt: devices.lastSeenAt,
				ipAddress: devices.ipAddress,
			})
			.from(devices)
			.where(eq(devices.hawkbitTargetId, targetId));

		if (fresh) {
			return {
				updateStatus: fresh.hawkbitUpdateStatus ?? 'unknown',
				connectionStatus: fresh.connectionStatus ?? 'unknown',
				lastSeen: fresh.lastSeenAt?.toISOString() ?? null,
				ipAddress: fresh.ipAddress ?? null,
			};
		}
	}

	try {
		const target = await hawkbitTargets.get(targetId);
		const isConnected = target.pollStatus ? !target.pollStatus.overdue : false;

		await db
			.update(devices)
			.set({ ...extractTargetData(target), updatedAt: new Date() })
			.where(eq(devices.hawkbitTargetId, targetId));

		return {
			updateStatus: target.updateStatus ?? 'unknown',
			connectionStatus: isConnected ? 'connected' : 'disconnected',
			lastSeen: target.pollStatus?.lastRequestAt
				? new Date(target.pollStatus.lastRequestAt).toISOString() : null,
			ipAddress: target.ipAddress ?? null,
		};
	} catch {
		return null;
	}
}

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

	// Emit SSE for this company
	const count = companyUpdates.get(companyId) ?? 0;
	if (count > 0) {
		import('@common/sse').then(({ sseEmitter }) => {
			// Push individual device status updates
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
	}

	return count;
}
