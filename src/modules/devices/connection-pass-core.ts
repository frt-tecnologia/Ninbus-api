/**
 * Connection Pass — PURE CORE (no IO, no hawkBit).
 *
 * Diff + orphan-rule + rotation budget for the always-on rotating observer
 * of device connection facts. Testable with HAWKBIT_ENABLED=false; the IO
 * wrapper (fetch pages, select rows, write, SSE) lives in connection-pass.ts.
 *
 * Single source of truth for "connected" is hawkBit's pollStatus (overdue
 * verdict) — there is no second, local opinion.
 */
import { isOnlineStatus, transitionOccurredAt } from '@modules/observability/connections-service';
import { extractTargetData } from './sync-core';

/** hawkBit targets page size (matches sync-fetch pagination). */
export const PAGE_SIZE = 500;

/** DB id-chunk size for IN() selects. */
export const ID_CHUNK = 500;

/** Local device row fields the pass observes (connection facts only). */
export interface FleetRow {
	id: string;
	companyId: string | null;
	hawkbitTargetId: string | null;
	name: string | null;
	connectionStatus: string | null;
	ipAddress: string | null;
	lastPollAt: Date | null;
	nextExpectedPollAt: Date | null;
	lastSeenAt: Date | null;
}

/** Connection-only patch written to the device row (updateStatus is enrichment's domain). */
export interface ConnectionPatch {
	connectionStatus: string;
	ipAddress: string | null;
	lastPollAt: Date | null;
	nextExpectedPollAt: Date | null;
	lastSeenAt: Date | null;
}

export interface ConnectionChange {
	row: FleetRow;
	patch: ConnectionPatch;
	/** Present only on a real online↔offline transition (telemetry chokepoint input). */
	transition: { event: 'online' | 'offline'; occurredAt: Date } | null;
}

/** Parse hawkBit polling time "HH:MM:SS" into seconds (fallback on malformed input). */
export function parsePollingIntervalSec(hhmmss: string, fallbackSec = 300): number {
	const m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(hhmmss.trim());
	if (!m) return fallbackSec;
	return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * Pages per tick so a FULL fleet rotation completes within ½ polling interval
 * at any scale: @5k → 2 pages/tick, @50k → 20 pages/tick (30s ticks, 5min polls).
 */
export function rotationBudget(totalTargets: number, pollingSec: number, tickSec: number): number {
	const pages = Math.ceil(Math.max(1, totalTargets) / PAGE_SIZE);
	const slots = Math.max(1, Math.floor(pollingSec / 2 / Math.max(1, tickSec)));
	return Math.max(1, Math.ceil(pages / slots));
}

function timeChanged(a: Date | null, b: Date | null): boolean {
	if ((a == null) !== (b == null)) return true;
	return a != null && b != null && a.getTime() !== b.getTime();
}

function factsChanged(row: FleetRow, patch: ConnectionPatch): boolean {
	return (
		row.connectionStatus !== patch.connectionStatus ||
		(row.ipAddress ?? null) !== (patch.ipAddress ?? null) ||
		timeChanged(row.lastPollAt, patch.lastPollAt) ||
		timeChanged(row.nextExpectedPollAt, patch.nextExpectedPollAt) ||
		timeChanged(row.lastSeenAt, patch.lastSeenAt)
	);
}

/**
 * Diff local fleet rows against the hawkBit target map (the tick's slice).
 * Missing targets are skipped here — orphans are judged only at rotation
 * completion (see findOrphanChanges). Steady-state rows produce no change.
 */
export function computeConnectionChanges(
	rows: FleetRow[],
	targetMap: Map<string, any>,
): ConnectionChange[] {
	const changes: ConnectionChange[] = [];
	for (const row of rows) {
		if (!row.hawkbitTargetId) continue;
		const target = targetMap.get(row.hawkbitTargetId);
		if (!target) continue;

		const facts = extractTargetData(target);
		const patch: ConnectionPatch = {
			connectionStatus: facts.connectionStatus,
			ipAddress: facts.ipAddress,
			lastPollAt: facts.lastPollAt,
			nextExpectedPollAt: facts.nextExpectedPollAt,
			lastSeenAt: facts.lastSeenAt,
		};
		if (!factsChanged(row, patch)) continue;

		const onlineNow = isOnlineStatus(patch.connectionStatus);
		const onlineBefore = isOnlineStatus(row.connectionStatus);
		changes.push({
			row,
			patch,
			transition:
				onlineNow !== onlineBefore && row.companyId
					? {
							event: onlineNow ? 'online' : 'offline',
							occurredAt: transitionOccurredAt(onlineNow ? 'online' : 'offline', {
								lastPollAt: facts.lastPollAt,
								nextExpectedPollAt: facts.nextExpectedPollAt,
							}),
						}
					: null,
		});
	}
	return changes;
}

/**
 * Orphan verdict (was the old sweep's WHY): devices still marked connected
 * locally whose target was ABSENT from a complete, successful rotation —
 * the target no longer exists in hawkBit, so it cannot be connected.
 */
export function findOrphanChanges(
	connectedRows: FleetRow[],
	seenControllerIds: Set<string>,
): ConnectionChange[] {
	const changes: ConnectionChange[] = [];
	for (const row of connectedRows) {
		if (!row.hawkbitTargetId || seenControllerIds.has(row.hawkbitTargetId)) continue;
		changes.push({
			row,
			patch: {
				connectionStatus: 'disconnected',
				ipAddress: row.ipAddress,
				lastPollAt: row.lastPollAt,
				nextExpectedPollAt: row.nextExpectedPollAt,
				lastSeenAt: row.lastSeenAt,
			},
			transition: row.companyId
				? {
						event: 'offline',
						occurredAt: transitionOccurredAt('offline', {
							lastPollAt: row.lastPollAt,
							nextExpectedPollAt: row.nextExpectedPollAt,
						}),
					}
				: null,
		});
	}
	return changes;
}
