import { db } from '@common/db';
import { deployments } from '@common/db/schema';
import type { TargetSnapshotEntry } from '@modules/deployments/snapshot';
import { and, gte, lte, or } from 'drizzle-orm';

/** Terminal snapshot phases — historical outcome events. */
const TERMINAL_PHASES = new Set(['installed', 'error', 'canceled']);

export interface TimelineBucket {
	start: string;
	end: string;
	/** Rollouts created in the bucket (assignment events). */
	assigned: number;
	/** Terminal outcomes confirmed in the bucket, from the canonical snapshot. */
	installed: number;
	failed: number;
	canceled: number;
}

export interface TimelineRow {
	createdAt: Date;
	targetStatusSnapshot: unknown;
}

/**
 * Buckets the deployment activity of a window.
 * Counts are EVENTS per bucket: a device that installs twice in the window
 * counts twice — each confirmation is its own outcome (see plan decision #1).
 * Non-terminal phases are current state, not history, and are excluded.
 */
export function buildTimeline(
	rows: TimelineRow[],
	from: Date,
	to: Date,
	bucketCount: number,
): { from: string; to: string; bucketMs: number; data: TimelineBucket[] } {
	const n = Math.max(2, Math.min(240, Math.round(bucketCount)));
	const bucketMs = Math.ceil((to.getTime() - from.getTime()) / n);
	const data: TimelineBucket[] = Array.from({ length: n }, (_, i) => {
		const start = new Date(from.getTime() + i * bucketMs);
		const end = new Date(i === n - 1 ? to.getTime() : from.getTime() + (i + 1) * bucketMs);
		return {
			start: start.toISOString(),
			end: end.toISOString(),
			assigned: 0,
			installed: 0,
			failed: 0,
			canceled: 0,
		};
	});

	const indexFor = (t: number) => {
		if (t < from.getTime() || t > to.getTime()) return -1;
		return Math.min(n - 1, Math.floor((t - from.getTime()) / bucketMs));
	};

	for (const row of rows) {
		const createdIdx = indexFor(new Date(row.createdAt).getTime());
		if (createdIdx >= 0) data[createdIdx].assigned += 1;

		const snapshot = (row.targetStatusSnapshot ?? {}) as Record<string, TargetSnapshotEntry>;
		for (const entry of Object.values(snapshot)) {
			if (!entry || !TERMINAL_PHASES.has(entry.phase)) continue;
			const at = Date.parse(entry.snapshotAt ?? '');
			if (Number.isNaN(at)) continue;
			const idx = indexFor(at);
			if (idx < 0) continue;
			if (entry.phase === 'installed') data[idx].installed += 1;
			else if (entry.phase === 'error') data[idx].failed += 1;
			else data[idx].canceled += 1;
		}
	}
	return { from: from.toISOString(), to: to.toISOString(), bucketMs, data };
}

/** Deployments overlapping the window (created before its end, active during it). */
export async function fetchDeploymentsForTimeline(from: Date, to: Date) {
	return db
		.select({
			createdAt: deployments.createdAt,
			targetStatusSnapshot: deployments.targetStatusSnapshot,
		})
		.from(deployments)
		.where(
			and(
				lte(deployments.createdAt, to),
				or(gte(deployments.updatedAt, from), gte(deployments.createdAt, from)),
			),
		);
}
