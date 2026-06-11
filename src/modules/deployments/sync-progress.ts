/**
 * Sync Progress — Real-time action status polling & SSE emission.
 *
 * The sync engine only reads target.updateStatus (high-level: pending/in_sync/error).
 * Detailed progress (downloading 25%, installing, etc.) lives in hawkBit action
 * status entries. This module bridges the gap: polls action statuses for devices
 * with pending updates and emits granular SSE events to the Flutter frontend.
 *
 * Scalability guards:
 *   - Hard cap: max 50 devices polled per cycle (round-robin for overflow)
 *   - Deduplication: same controllerId only polled once per cycle
 *   - Skips poll when lastModifiedAt hasn't changed (device hasn't reported)
 *   - Final event emission when device leaves 'pending' state
 *   - DS resolution: one getAssignedDS per unique controllerId (cached per cycle)
 */
import { hawkbitConfig } from '@common/config/hawkbit';
import { hawkbitTargets } from '@common/hawkbit/client';
import { appLogger } from '@common/logger';
import { sseEmitter } from '@common/sse';
import { enrichActionStatus, getLatestProgress } from '@common/types/deployment-status-helpers';
import type { EnrichedActionStatus } from '@common/types/deployment-status';
import type { ChangedDevice } from '@modules/devices/sync-helpers';
import { getCompanyDsIds, emitFinalEvents, emitDeploymentStatsForDs } from './sync-progress-helpers';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max devices to poll per cycle — keeps hawkBit load under 20 req/s at 5s interval. */
const MAX_DEVICES_PER_CYCLE = 50;

/** Cache TTL — clears stale entries for completed deployments. */
const CACHE_TTL_MS = 300_000;

// ---------------------------------------------------------------------------
// State: caches for dedup + skip-unchanged + final event tracking
// ---------------------------------------------------------------------------

/** Tracks last actionId + lastModifiedAt per controllerId to skip redundant polls. */
const actionCache = new Map<string, { actionId: number; lastModifiedAt: number | null }>();

/** Round-robin offset for when pending devices exceed MAX_DEVICES_PER_CYCLE. */
let roundRobinOffset = 0;

let lastCachePurge = Date.now();

/** Tracks ALL controllerIds pending in previous cycle for final-event detection. */
const previouslyPending = new Map<string, { companyId: string; deviceId: string }>();

// ---------------------------------------------------------------------------
// Concurrency limiter
// ---------------------------------------------------------------------------

async function parallelLimit<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
	const results: T[] = [];
	let idx = 0;
	async function worker() {
		while (idx < tasks.length) {
			const i = idx++;
			results[i] = await tasks[i]();
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
	return results;
}

// ---------------------------------------------------------------------------
// Per-cycle DS resolution — one getAssignedDS per controllerId, batched
// ---------------------------------------------------------------------------

/** Batch-resolve dsId for controllerIds against a company's DS IDs. */
async function batchResolveDsIds(
	controllerIds: string[],
	companyDsIds: number[],
): Promise<Map<string, number>> {
	const result = new Map<string, number>();
	if (companyDsIds.length === 0 || controllerIds.length === 0) return result;

	const resolveTasks = controllerIds.map(async (cid) => {
		try {
			const assigned = await hawkbitTargets.getAssignedDS(cid);
			const match = assigned.find((ds) => companyDsIds.includes(ds.id));
			if (match) result.set(cid, match.id);
		} catch {
			// Non-critical — dsId is best-effort
		}
	});
	await parallelLimit(resolveTasks, 10);
	return result;
}

// ---------------------------------------------------------------------------
// Single device: poll action status and emit SSE
// ---------------------------------------------------------------------------

interface ActionProgressResult {
	controllerId: string;
	actionId: number;
	dsId: number | null;
}

async function pollAndEmitDeviceAction(
	companyId: string,
	deviceId: string,
	controllerId: string,
	dsIdMap: Map<string, number>,
): Promise<ActionProgressResult | null> {
	try {
		const actions = await hawkbitTargets.getActions(controllerId, { limit: 10, sort: 'id:DESC' });
		const updateAction = actions.content.find((a) => a.type === 'update' && a.active);
		if (!updateAction) return null;

		// Skip poll if action hasn't changed since last cycle
		const cached = actionCache.get(controllerId);
		if (cached && cached.actionId === updateAction.id && cached.lastModifiedAt === updateAction.lastModifiedAt) {
			return null;
		}

		const statusResult = await hawkbitTargets.getActionStatus(controllerId, updateAction.id, { limit: 5 });

		// Update cache
		actionCache.set(controllerId, {
			actionId: updateAction.id,
			lastModifiedAt: updateAction.lastModifiedAt ?? null,
		});

		if (statusResult.content.length === 0) {
			sseEmitter.emit(companyId, 'device.action.status', {
				deviceId, controllerId,
				actionId: updateAction.id,
				latestStatus: 'running', phase: 'assigned',
				progress: null,
				message: 'Assignment initiated — waiting for device poll',
				timestamp: new Date().toISOString(),
			});
			return { controllerId, actionId: updateAction.id, dsId: dsIdMap.get(controllerId) ?? null };
		}

		const latest = statusResult.content[0]!;
		const enriched: EnrichedActionStatus = enrichActionStatus(latest);
		const progress = getLatestProgress(statusResult.content);

		sseEmitter.emit(companyId, 'device.action.status', {
			deviceId, controllerId,
			actionId: updateAction.id,
			latestStatus: latest.type,
			phase: enriched.phase,
			progress,
			message: enriched.displayMessage,
			timestamp: new Date().toISOString(),
		});

		return { controllerId, actionId: updateAction.id, dsId: dsIdMap.get(controllerId) ?? null };
	} catch (error: any) {
		appLogger.debug('[SYNC-PROGRESS] Failed to poll action for %s: %s', controllerId, error?.message ?? 'unknown');
		return null;
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Poll action statuses for devices with pending updates and emit SSE events.
 * Called after each sync cycle.
 *
 * Scalability: hard cap of MAX_DEVICES_PER_CYCLE per call, round-robin for overflow.
 * Deduplication by controllerId. Skips unchanged actions via cache.
 * Emits final event when device leaves pending state.
 */
export async function emitActionProgressEvents(changedDevices: ChangedDevice[]): Promise<void> {
	if (!hawkbitConfig.enabled) return;

	// Purge cache periodically
	const now = Date.now();
	if (now - lastCachePurge > CACHE_TTL_MS) {
		actionCache.clear();
		previouslyPending.clear();
		lastCachePurge = now;
	}

// Step 1: Final events for devices that LEFT pending
	const nonPending = changedDevices.filter((d) => d.hawkbitUpdateStatus !== 'pending');
	if (nonPending.length > 0 && previouslyPending.size > 0) {
		emitFinalEvents(nonPending, previouslyPending).catch(() => {});
	}

	// Step 2: Filter to pending + deduplicate
	const seen = new Set<string>();
	const uniquePending: ChangedDevice[] = [];
	for (const d of changedDevices) {
		if (d.hawkbitUpdateStatus !== 'pending') continue;
		if (seen.has(d.controllerId)) continue;
		seen.add(d.controllerId);
		uniquePending.push(d);
	}

	// Track ALL pending devices for next cycle's final-event detection (before capping)
	for (const d of uniquePending) {
		previouslyPending.set(d.controllerId, { companyId: d.companyId, deviceId: d.deviceId });
	}

	if (uniquePending.length === 0) return;

	// Step 3: Hard cap with round-robin
	let toPoll: ChangedDevice[];
	if (uniquePending.length <= MAX_DEVICES_PER_CYCLE) {
		toPoll = uniquePending;
		roundRobinOffset = 0;
	} else {
		const start = roundRobinOffset % uniquePending.length;
		toPoll = [];
		for (let i = 0; i < MAX_DEVICES_PER_CYCLE; i++) {
			toPoll.push(uniquePending[(start + i) % uniquePending.length]!);
		}
		roundRobinOffset = start + MAX_DEVICES_PER_CYCLE;
		appLogger.debug('[SYNC-PROGRESS] Round-robin: polling %d/%d (offset=%d)', toPoll.length, uniquePending.length, start);
	}

	appLogger.debug('[SYNC-PROGRESS] Polling action status for %d device(s)', toPoll.length);

	// Step 4: Group by companyId, resolve DS IDs, poll
	const byCompany = new Map<string, ChangedDevice[]>();
	for (const d of toPoll) {
		const list = byCompany.get(d.companyId) ?? [];
		list.push(d);
		byCompany.set(d.companyId, list);
	}

	for (const [companyId, companyDevices] of byCompany) {
		// Pre-fetch DS IDs + batch resolve dsIds
		const companyDsIds = await getCompanyDsIds(companyId);
		const controllerIds = companyDevices.map((d) => d.controllerId);
		const dsIdMap = await batchResolveDsIds(controllerIds, companyDsIds);

		const results = await parallelLimit(
			companyDevices.map((d) => () => pollAndEmitDeviceAction(companyId, d.deviceId, d.controllerId, dsIdMap)),
			10,
		);

		const dsIds = new Set<number>();
		for (const r of results) {
			if (r?.dsId) dsIds.add(r.dsId);
		}
		if (dsIds.size > 0) await emitDeploymentStatsForDs(dsIds, companyId);
	}
}
