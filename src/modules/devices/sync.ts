import { hawkbitConfig } from '@common/config/hawkbit';
import { db } from '@common/db';
import { devices, session, companyMembers } from '@common/db/schema';
import { hawkbitTargets } from '@common/hawkbit/client';
import { appLogger } from '@common/logger';
import { sseEmitter } from '@common/sse';
import { and, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import {
	type SyncState,
	batchUpdateDevicesFromTargets,
	extractTargetData,
	fetchAllHawkBitTargets,
	fetchModifiedTargets,
	fetchTargetsByIds,
	syncCompanyOnDemand,
	syncNewTargets,
	syncPendingDevices,
	syncSingleDeviceSwr,
} from './sync-helpers';

/** Sync Engine for hawkBit ↔ Ninbus — 3 modes + SSE push. */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state: SyncState = {
	lastFullSyncAt: null,
	isRunning: false,
	totalSynced: 0,
	lastDurationMs: 0,
	errors: 0,
	mode: hawkbitConfig.syncMode,
	lastIncrementalTimestamp: null,
};

let syncTimer: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Active company detection (hybrid mode)
// ---------------------------------------------------------------------------

/** Find company IDs with active user sessions within the configured window. */
async function getActiveCompanyIds(): Promise<Set<string>> {
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
async function getTargetIdsForCompanies(companyIds: Set<string>) {
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
function emitSseBatchUpdates(
	companyUpdates: Map<string, number>,
	changedDevices?: { deviceId: string; companyId: string; connectionStatus: string; hawkbitUpdateStatus: string; lastPollAt: Date | null; ipAddress: string | null }[],
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
async function syncPeriodic() {
	const targetMap = await fetchAllHawkBitTargets();
	await syncNewTargets(targetMap);

	// Fetch with companyId for SSE
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

	// SSE: push updates to connected clients
	emitSseBatchUpdates(companyUpdates, changedDevices);

	let total = 0;
	for (const count of companyUpdates.values()) total += count;
	state.totalSynced = total;
}

/** Hybrid: sync ONLY targets belonging to active companies + incremental. */
async function syncHybrid() {
	const activeCompanyIds = await getActiveCompanyIds();

	if (activeCompanyIds.size === 0) {
		appLogger.debug('[SYNC] Hybrid: no active companies — skipping');
		return;
	}

	const companyDevices = await getTargetIdsForCompanies(activeCompanyIds);
	if (companyDevices.length === 0) return;

	const controllerIds = companyDevices
		.map((d) => d.hawkbitTargetId)
		.filter((id): id is string => id !== null);

	let targetMap: Map<string, any>;

	if (state.lastIncrementalTimestamp) {
		targetMap = await fetchModifiedTargets(state.lastIncrementalTimestamp);
		const companyMap = await fetchTargetsByIds(controllerIds);
		for (const [id, target] of companyMap) {
			if (!targetMap.has(id)) targetMap.set(id, target);
		}
	} else {
		targetMap = await fetchTargetsByIds(controllerIds);
	}

	const { companyUpdates, changedDevices } = await batchUpdateDevicesFromTargets(companyDevices, targetMap);

	// SSE: push updates to connected clients
	emitSseBatchUpdates(companyUpdates, changedDevices);

	state.lastIncrementalTimestamp = Date.now();

	let total = 0;
	for (const count of companyUpdates.values()) total += count;
	state.totalSynced = total;

	if (total > 0) {
		appLogger.info(
			`[SYNC] Hybrid: ${total} devices updated for ${activeCompanyIds.size} companies`,
		);
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const DeviceSyncEngine = {
	/** Start sync engine based on HAWKBIT_SYNC_MODE. Called at app startup. */
	startBackgroundSync() {
		if (!hawkbitConfig.enabled) {
			appLogger.info('[SYNC] hawkBit disabled — sync not started');
			return;
		}

		const mode = hawkbitConfig.syncMode;
		const intervalSec = hawkbitConfig.syncIntervalSec;

		appLogger.info(
			`[SYNC] Mode: ${mode}` +
			(mode !== 'on_demand' ? `, interval: ${intervalSec}s` : ', no background') +
			(mode === 'hybrid' ? `, active window: ${hawkbitConfig.syncActiveWindowSec}s` : ''),
		);

		// Start SSE heartbeat
		sseEmitter.startHeartbeat();

		if (mode === 'on_demand' || intervalSec <= 0) return;

		setTimeout(() => this.runSyncCycle(), 5000);

		syncTimer = setInterval(() => {
			this.runSyncCycle().catch((err) => {
				appLogger.error(`[SYNC] Error: ${err?.message}`);
				state.errors++;
			});
		}, intervalSec * 1000);
	},

	stopBackgroundSync() {
		if (syncTimer) {
			clearInterval(syncTimer);
			syncTimer = null;
			appLogger.info('[SYNC] Background sync stopped');
		}
		sseEmitter.stopHeartbeat();
	},

	getState(): SyncState {
		return { ...state };
	},

	/** Main sync cycle — dispatches to periodic or hybrid strategy. */
	async runSyncCycle() {
		if (state.isRunning) return;
		state.isRunning = true;
		const startTime = Date.now();

		try {
			switch (hawkbitConfig.syncMode) {
				case 'periodic': await syncPeriodic(); break;
				case 'hybrid': await syncHybrid(); break;
			}
			state.lastFullSyncAt = new Date();
			state.lastDurationMs = Date.now() - startTime;
		} catch (error: any) {
			state.errors++;
			appLogger.error(`[SYNC] Cycle failed: ${error?.message}`);
		} finally {
			state.isRunning = false;
		}
	},

	/** Discover auto-provisioned targets. Public API for admin endpoint. */
	async discoverAutoProvisioned(): Promise<number> {
		if (!hawkbitConfig.enabled) return 0;
		const targetMap = await fetchAllHawkBitTargets();
		await syncNewTargets(targetMap);
		const localDevices = await db.select({ hawkbitTargetId: devices.hawkbitTargetId }).from(devices);
		return localDevices.length;
	},

	/** Legacy — kept for backward compatibility. */
	async syncCompany(_companyId: string) { /* no-op */ },

	/** Single-device stale-while-revalidate (used by all modes). */
	async syncSingleDevice(targetId: string): Promise<{
		updateStatus: string; connectionStatus: string; lastSeen: string | null; ipAddress: string | null;
	} | null> {
		return syncSingleDeviceSwr(targetId);
	},

	/** Company-scoped on-demand sync (fire-and-forget on GET /devices). */
	async syncCompanyDevices(companyId: string): Promise<number> {
		return syncCompanyOnDemand(companyId);
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
