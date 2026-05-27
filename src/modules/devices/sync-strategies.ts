/**
 * Sync Engine — Strategies (periodic, hybrid) and SSE helpers.
 */
import { db } from '@common/db';
import { devices, session, companyMembers } from '@common/db/schema';
import { hawkbitConfig } from '@common/config/hawkbit';
import { appLogger } from '@common/logger';
import { sseEmitter } from '@common/sse';
import { and, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import {
	batchUpdateDevicesFromTargets,
	type ChangedDevice,
	fetchAllHawkBitTargets,
	fetchModifiedTargets,
	fetchTargetsByIds,
	syncNewTargets,
	syncPendingDevices,
} from './sync-helpers';

// ---------------------------------------------------------------------------
// Active company detection (hybrid mode)
// ---------------------------------------------------------------------------

/** Find company IDs with active user sessions within the configured window. */
export async function getActiveCompanyIds(): Promise<Set<string>> {
	const cutoff = new Date(Date.now() - hawkbitConfig.syncActiveWindowSec * 1000);

	try {
		const rows = await db
			.selectDistinct({ companyId: companyMembers.companyId })
			.from(session)
			.innerJoin(companyMembers, eq(session.userId, companyMembers.userId))
			.where(gt(session.updatedAt, cutoff));

		return new Set(rows.map((r) => r.companyId).filter(Boolean));
	} catch {
		return new Set();
	}
}

/** Get hawkbit target IDs for a set of companies (with companyId field). */
export async function getTargetIdsForCompanies(companyIds: Set<string>) {
	if (companyIds.size === 0) return [];
	return db
		.select({ id: devices.id, hawkbitTargetId: devices.hawkbitTargetId, companyId: devices.companyId })
		.from(devices)
		.where(
			and(
				inArray(devices.companyId, [...companyIds]),
				eq(devices.status, 'accepted'),
				isNotNull(devices.hawkbitTargetId),
			),
		);
}

// ---------------------------------------------------------------------------
// SSE emission helpers
// ---------------------------------------------------------------------------

/** Emit SSE events for each company with device updates. */
export function emitSseBatchUpdates(
	companyUpdates: Map<string, number>,
	changedDevices?: ChangedDevice[],
): void {
	for (const [companyId, count] of companyUpdates) {
		if (changedDevices) {
			for (const d of changedDevices) {
				if (d.companyId === companyId) {
					sseEmitter.emit(companyId, 'device.status', {
						deviceId: d.deviceId,
						connectionStatus: d.connectionStatus,
						hawkbitUpdateStatus: d.hawkbitUpdateStatus,
						lastPollAt: d.lastPollAt?.toISOString() ?? null,
						ipAddress: d.ipAddress,
					});

					if (d.hawkbitUpdateStatus === 'pending') {
						sseEmitter.emit(companyId, 'device.deployment', {
							deviceId: d.deviceId,
							controllerId: d.controllerId,
							status: 'pending',
							message: 'Update pending — waiting for device poll',
							timestamp: new Date().toISOString(),
						});
					}
				}
			}
		}
		sseEmitter.emit(companyId, 'devices.batch', { count });
	}
}

// ---------------------------------------------------------------------------
// Sync Strategies
// ---------------------------------------------------------------------------

/** Periodic: sync ALL targets (legacy behavior). */
export async function syncPeriodic() {
	const targetMap = await fetchAllHawkBitTargets();
	await syncNewTargets(targetMap);

	const allAccepted = await db
		.select({ id: devices.id, hawkbitTargetId: devices.hawkbitTargetId, companyId: devices.companyId })
		.from(devices)
		.where(eq(devices.status, 'accepted'));

	const withTargetId = allAccepted.filter(
		(d): d is { id: string; hawkbitTargetId: string; companyId: string | null } =>
			d.hawkbitTargetId !== null,
	);
	const { companyUpdates, changedDevices } = await batchUpdateDevicesFromTargets(withTargetId, targetMap);
	await syncPendingDevices(targetMap);
	emitSseBatchUpdates(companyUpdates, changedDevices);

	let total = 0;
	for (const count of companyUpdates.values()) total += count;
	return total;
}

/** Hybrid: sync ONLY targets belonging to active companies + incremental. */
export async function syncHybrid() {
	const activeCompanyIds = await getActiveCompanyIds();

	if (activeCompanyIds.size === 0) {
		appLogger.debug('[SYNC] Hybrid: no active companies — skipping');
		return 0;
	}

	const companyDevices = await getTargetIdsForCompanies(activeCompanyIds);
	if (companyDevices.length === 0) return 0;

	const controllerIds = companyDevices
		.map((d) => d.hawkbitTargetId)
		.filter((id): id is string => id !== null);

	let targetMap: Map<string, any>;
	const lastTs = (globalThis as any).__syncLastIncrementalTs as number | null;

	if (lastTs) {
		targetMap = await fetchModifiedTargets(lastTs);
		const companyMap = await fetchTargetsByIds(controllerIds);
		for (const [id, target] of companyMap) {
			if (!targetMap.has(id)) targetMap.set(id, target);
		}
	} else {
		targetMap = await fetchTargetsByIds(controllerIds);
	}

	const { companyUpdates, changedDevices } = await batchUpdateDevicesFromTargets(companyDevices, targetMap);
	emitSseBatchUpdates(companyUpdates, changedDevices);

	(globalThis as any).__syncLastIncrementalTs = Date.now();

	let total = 0;
	for (const count of companyUpdates.values()) total += count;

	if (total > 0) {
		appLogger.info('[SYNC] Hybrid: %d devices updated for %d companies', total, activeCompanyIds.size);
	}
	return total;
}
