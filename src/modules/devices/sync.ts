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
import { fetchAllHawkBitTargets } from './sync-fetch';
import {
	type SyncState,
	syncCompanyOnDemand,
	syncNewTargets,
	syncSingleDeviceSwr,
} from './sync-helpers';
import { markOverdueDevicesOffline } from './sync-helpers';
import { syncHybrid, syncPeriodic } from './sync-strategies';

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
let fastSyncTimer: ReturnType<typeof setInterval> | null = null;
let hasPendingDeployments = false;

/** Fast sync interval when deployments are active (seconds). */
const FAST_SYNC_INTERVAL_SEC = 5;

/** Check if any device has hawkbitUpdateStatus='pending'. */
async function detectPendingDeployments(): Promise<boolean> {
	try {
		const [row] = await db
			.select({ id: devices.id })
			.from(devices)
			.where(eq(devices.hawkbitUpdateStatus, 'pending'))
			.limit(1);
		return !!row;
	} catch {
		return false;
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
		}
		if (fastSyncTimer) {
			clearInterval(fastSyncTimer);
			fastSyncTimer = null;
		}
		hasPendingDeployments = false;
		appLogger.info('[SYNC] Background sync stopped');
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
				case 'periodic':
					state.totalSynced = await syncPeriodic();
					break;
				case 'hybrid':
					state.totalSynced = await syncHybrid();
					break;
			}

			// Staleness sweep: self-heal orphaned/overdue devices (independent of
			// hawkBit). Catches devices whose hawkBit target was deleted and would
			// otherwise freeze at 'connected' forever.
			await markOverdueDevicesOffline();

			state.lastFullSyncAt = new Date();
			state.lastDurationMs = Date.now() - startTime;

			// After each cycle, check if we need to switch to fast sync
			await this.adjustSyncSpeed();
		} catch (error: any) {
			state.errors++;
			appLogger.error('[SYNC] Cycle failed: %s', error?.message);
		} finally {
			state.isRunning = false;
		}
	},

	/** Detect active deployments and switch between normal/fast sync.
	 *  When fast sync activates, normal sync timer is PAUSED to avoid contention.
	 *  When fast sync deactivates, normal sync timer is RESUMED.
	 */
	async adjustSyncSpeed() {
		const newPending = await detectPendingDeployments();
		const mode = hawkbitConfig.syncMode;
		const intervalSec = hawkbitConfig.syncIntervalSec;

		if (newPending && !hasPendingDeployments) {
			// Deployments started — pause normal sync, activate fast sync
			hasPendingDeployments = true;
			if (mode !== 'on_demand' && intervalSec > 0) {
				// Pause normal timer to avoid contention
				if (syncTimer) {
					clearInterval(syncTimer);
					syncTimer = null;
				}
				appLogger.info(
					'[SYNC] Active deployment detected — fast sync enabled (%ds), normal sync paused',
					FAST_SYNC_INTERVAL_SEC,
				);
				fastSyncTimer = setInterval(() => {
					this.runSyncCycle().catch((err) => {
						appLogger.debug('[SYNC] Fast cycle error: %s', err?.message);
					});
				}, FAST_SYNC_INTERVAL_SEC * 1000);
			}
		} else if (!newPending && hasPendingDeployments) {
			// All deployments finished — deactivate fast sync, resume normal
			hasPendingDeployments = false;
			if (fastSyncTimer) {
				clearInterval(fastSyncTimer);
				fastSyncTimer = null;
			}
			// Resume normal timer
			if (mode !== 'on_demand' && intervalSec > 0 && !syncTimer) {
				syncTimer = setInterval(() => {
					this.runSyncCycle().catch((err) => {
						appLogger.error('[SYNC] Error: %s', err?.message);
						state.errors++;
					});
				}, intervalSec * 1000);
				appLogger.info(
					'[SYNC] All deployments complete — fast sync disabled, normal sync resumed (%ds)',
					intervalSec,
				);
			}
		}
	},

	/** Discover auto-provisioned targets. Public API for admin endpoint. */
	async discoverAutoProvisioned(): Promise<number> {
		if (!hawkbitConfig.enabled) return 0;
		const targetMap = await fetchAllHawkBitTargets();
		await syncNewTargets(targetMap);
		const localDevices = await db
			.select({ hawkbitTargetId: devices.hawkbitTargetId })
			.from(devices);
		return localDevices.length;
	},

	/**
	 * Force a FULL sync of ALL devices from hawkBit (bypasses the isRunning
	 * guard). Used by the admin "Atualizar status" button to refresh every
	 * device's connectionStatus / lastSeenAt / pollStatus on demand. Returns
	 * the number of devices whose state changed.
	 */
	async forceSyncAll(): Promise<{ updated: number; disabled: boolean }> {
		if (!hawkbitConfig.enabled) return { updated: 0, disabled: true };
		const startTime = Date.now();
		try {
			// syncPeriodic fetches ALL hawkBit targets and batch-updates local
			// devices (connectionStatus, lastSeenAt, hawkbitUpdateStatus, ...).
			const updated = await syncPeriodic();
			state.lastFullSyncAt = new Date();
			state.lastDurationMs = Date.now() - startTime;
			return { updated, disabled: false };
		} catch (error: any) {
			state.errors++;
			appLogger.error('[SYNC] forceSyncAll failed: %s', error?.message);
			throw error;
		}
	},

	/** Legacy — kept for backward compatibility. */
	async syncCompany(_companyId: string) {
		/* no-op */
	},

	/** Single-device stale-while-revalidate (used by all modes). */
	async syncSingleDevice(targetId: string) {
		return syncSingleDeviceSwr(targetId, {
			enabled: hawkbitConfig.enabled,
			syncStaleSec: hawkbitConfig.syncStaleSec,
		});
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
