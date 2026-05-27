/**
 * Sync Engine for hawkBit ↔ Ninbus — orchestrator.
 *
 * 3 modes: periodic, on_demand, hybrid.
 * Delegates to sync-strategies.ts for strategy implementations.
 * Types, fetch utilities, and batch operations live in split files:
 *   - sync-core.ts: types, status protection, single-device sync
 *   - sync-fetch.ts: hawkBit paginated target queries
 *   - sync-helpers.ts: batch DB ops, on-demand sync, re-exports
 *   - sync-strategies.ts: periodic/hybrid strategies, SSE helpers
 */
import { hawkbitConfig } from '@common/config/hawkbit';
import { db } from '@common/db';
import { devices } from '@common/db/schema';
import { hawkbitTargets } from '@common/hawkbit/client';
import { appLogger } from '@common/logger';
import { sseEmitter } from '@common/sse';
import { eq } from 'drizzle-orm';
import {
	type SyncState,
	syncSingleDeviceSwr,
	syncCompanyOnDemand,
	syncNewTargets,
} from './sync-helpers';
import { fetchAllHawkBitTargets } from './sync-fetch';
import { syncPeriodic, syncHybrid } from './sync-strategies';

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
			'[SYNC] Mode: %s%s%s',
			mode,
			mode !== 'on_demand' ? `, interval: ${intervalSec}s` : ', no background',
			mode === 'hybrid' ? `, active window: ${hawkbitConfig.syncActiveWindowSec}s` : '',
		);

		sseEmitter.startHeartbeat();
		if (mode === 'on_demand' || intervalSec <= 0) return;

		setTimeout(() => this.runSyncCycle(), 5000);
		syncTimer = setInterval(() => {
			this.runSyncCycle().catch((err) => {
				appLogger.error('[SYNC] Error: %s', err?.message);
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
				case 'periodic': state.totalSynced = await syncPeriodic(); break;
				case 'hybrid': state.totalSynced = await syncHybrid(); break;
			}
			state.lastFullSyncAt = new Date();
			state.lastDurationMs = Date.now() - startTime;
		} catch (error: any) {
			state.errors++;
			appLogger.error('[SYNC] Cycle failed: %s', error?.message);
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
	async syncSingleDevice(targetId: string) {
		return syncSingleDeviceSwr(targetId, { enabled: hawkbitConfig.enabled, syncStaleSec: hawkbitConfig.syncStaleSec });
	},

	/** Company-scoped on-demand sync (fire-and-forget on GET /devices). */
	async syncCompanyDevices(companyId: string): Promise<number> {
		return syncCompanyOnDemand(companyId);
	},

	/** Delete a target from hawkBit. */
	async deleteTarget(targetId: string) {
		try {
			await hawkbitTargets.delete(targetId);
			appLogger.info('[SYNC] Target %s deleted from hawkBit', targetId);
		} catch {
			appLogger.debug('[SYNC] Delete failed for %s', targetId);
		}
	},
};
