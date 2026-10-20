/**
 * Connection Pass — IO wrapper for the always-on rotating observer.
 *
 * Base process of the sync engine (replaces the old staleness sweep): every
 * tick it reads a ROTATING SLICE of hawkBit targets and mirrors connection
 * facts (connectionStatus / lastPollAt / nextExpectedPollAt / lastSeenAt /
 * ipAddress) into the local DB, recording online↔offline transitions through
 * the single telemetry chokepoint. The pure diff/orphan/budget core lives in
 * connection-pass-core.ts (testable without hawkBit).
 *
 * Rotation budget derives from EXISTING config (polling interval + sync
 * interval) so a full fleet rotation completes within ½ polling interval at
 * ANY scale, with constant per-tick cost. Steady state writes ZERO rows
 * (diff-before-write); an online device writes once per observed poll — the
 * theoretical minimum for poll-based inference.
 */
import { hawkbitConfig } from '@common/config/hawkbit';
import { db } from '@common/db';
import { devices } from '@common/db/schema';
import { hawkbitTargets } from '@common/hawkbit/client';
import { appLogger } from '@common/logger';
import { recordConnectionTransition } from '@modules/observability/connections-service';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import {
	type ConnectionChange,
	computeConnectionChanges,
	type FleetRow,
	findOrphanChanges,
	ID_CHUNK,
	PAGE_SIZE,
	parsePollingIntervalSec,
	rotationBudget,
} from './connection-pass-core';
import { withConnectionWriteLock } from './sync-core';

export {
	type ConnectionChange,
	type ConnectionPatch,
	computeConnectionChanges,
	type FleetRow,
	findOrphanChanges,
	parsePollingIntervalSec,
	rotationBudget,
} from './connection-pass-core';

// ---------------------------------------------------------------------------
// Apply changes (serialized with the enrichment writer)
// ---------------------------------------------------------------------------

/** Write patches + funnel transitions through the telemetry chokepoint. */
async function applyConnectionChanges(changes: ConnectionChange[]): Promise<number> {
	const now = new Date();
	let transitions = 0;
	for (const change of changes) {
		await db
			.update(devices)
			.set({ ...change.patch, updatedAt: now })
			.where(eq(devices.id, change.row.id));

		// Telemetry requires a company (same guard the old sweep had).
		if (change.transition && change.row.companyId) {
			transitions++;
			void recordConnectionTransition({
				deviceId: change.row.id,
				companyId: change.row.companyId,
				hawkbitTargetId: change.row.hawkbitTargetId,
				deviceName: change.row.name ?? change.row.hawkbitTargetId ?? change.row.id,
				previous: change.row.connectionStatus,
				current: change.patch.connectionStatus,
				occurredAt: change.transition.occurredAt,
				ipAddress: change.patch.ipAddress,
			}).catch(() => {
				/* telemetry is best-effort */
			});
		}
	}
	return transitions;
}

const FLEET_FIELDS = {
	id: devices.id,
	companyId: devices.companyId,
	hawkbitTargetId: devices.hawkbitTargetId,
	name: devices.name,
	connectionStatus: devices.connectionStatus,
	ipAddress: devices.ipAddress,
	lastPollAt: devices.lastPollAt,
	nextExpectedPollAt: devices.nextExpectedPollAt,
	lastSeenAt: devices.lastSeenAt,
};

/** Select fleet rows whose target is in the current slice (chunked IN, indexed). */
async function selectRowsByTargetIds(ids: string[]): Promise<FleetRow[]> {
	const rows: FleetRow[] = [];
	for (let i = 0; i < ids.length; i += ID_CHUNK) {
		const chunk = ids.slice(i, i + ID_CHUNK);
		const part = await db
			.select(FLEET_FIELDS)
			.from(devices)
			.where(inArray(devices.hawkbitTargetId, chunk));
		rows.push(...part);
	}
	return rows;
}

/** Devices currently marked connected locally (orphan candidates at rotation end). */
async function selectConnectedRows(): Promise<FleetRow[]> {
	return db
		.select(FLEET_FIELDS)
		.from(devices)
		.where(
			and(
				inArray(devices.connectionStatus, ['connected', 'online']),
				isNotNull(devices.hawkbitTargetId),
			),
		);
}

// ---------------------------------------------------------------------------
// Rotating tick (the always-on base timer's callback)
// ---------------------------------------------------------------------------

/** Rotation state: cursor (targets consumed), seen ids, error flag (I2 guard). */
let rotationCursor = 0;
let rotationSeen = new Set<string>();
let rotationHadError = false;
let tickRunning = false;

function resetRotation(): void {
	rotationCursor = 0;
	rotationSeen = new Set();
	rotationHadError = false;
}

/**
 * One pass tick: fetch `rotationBudget` hawkBit target pages from the cursor,
 * mirror the slice's connection facts, and — when the rotation completes
 * without any page error — judge orphans. Any fetch failure keeps the cursor
 * in place (retry next tick) and marks the rotation incomplete, so absence is
 * NEVER judged on partial data.
 */
export async function runConnectionPassTick(): Promise<void> {
	if (!hawkbitConfig.enabled || tickRunning) return;
	tickRunning = true;

	try {
		const first = await hawkbitTargets.list({ offset: rotationCursor, limit: PAGE_SIZE });
		const total = first.total ?? first.content.length;
		if (total === 0) {
			resetRotation();
			return;
		}

		const budget = rotationBudget(
			total,
			parsePollingIntervalSec(hawkbitConfig.pollingTime),
			hawkbitConfig.syncIntervalSec,
		);
		const slice: any[] = [...first.content];
		for (let fetched = 1; fetched < budget && slice.length < total; fetched++) {
			const page = await hawkbitTargets.list({
				offset: rotationCursor + slice.length,
				limit: PAGE_SIZE,
			});
			if (page.content.length === 0) break;
			slice.push(...page.content);
		}

		const targetMap = new Map<string, any>();
		for (const target of slice) {
			if (target.controllerId) {
				targetMap.set(target.controllerId, target);
				rotationSeen.add(target.controllerId);
			}
		}
		rotationCursor += slice.length;

		let transitions = 0;
		let updates = 0;
		if (targetMap.size > 0) {
			// CAS vs the enrichment writer: read-compute-write atomically INSIDE
			// the lock — the previous state is fresh, so a transition already
			// recorded by the other writer becomes a no-op here (no duplicates).
			transitions = await withConnectionWriteLock(async () => {
				const rows = await selectRowsByTargetIds([...targetMap.keys()]);
				const changes = computeConnectionChanges(rows, targetMap);
				updates = changes.length;
				return applyConnectionChanges(changes);
			});
		}

		// Rotation completion: orphan verdict only on a fully successful rotation.
		if (rotationCursor >= total) {
			if (!rotationHadError) {
				const orphans = findOrphanChanges(await selectConnectedRows(), rotationSeen);
				if (orphans.length > 0) {
					transitions += await withConnectionWriteLock(() => applyConnectionChanges(orphans));
					appLogger.info(
						'[CONN-PASS] Rotation complete: %d orphan(s) marked offline',
						orphans.length,
					);
				}
			}
			resetRotation();
		}

		if (transitions > 0) {
			appLogger.info(
				'[CONN-PASS] tick: %d targets (cursor %d/%d), %d update(s), %d transition(s)',
				slice.length,
				Math.min(rotationCursor, total),
				total,
				updates,
				transitions,
			);
		}
	} catch (error: any) {
		// Fetch/apply failure: rotation incomplete → no orphan verdict next
		// completion; cursor stays where it was advanced to (fetch errors
		// happen before the advance, so the same slice retries next tick).
		rotationHadError = true;
		appLogger.debug('[CONN-PASS] tick failed (rotation kept incomplete): %s', error?.message);
	} finally {
		tickRunning = false;
	}
}
