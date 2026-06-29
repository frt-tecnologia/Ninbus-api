/**
 * Deployment target status snapshot — the Ninbus-canonical history.
 *
 * hawkBit does NOT preserve per-target status once an action is cancelled or
 * superseded by a newer DS assignment. Without this snapshot, deployments that
 * had devices cancelled by a concurrent deployment LOSE their history.
 *
 * STICKY-FINISHED RULE: once a target's phase is 'installed', the snapshot is
 * FROZEN and NEVER overwritten — not even by a cancellation.
 */
import { db } from '@common/db';
import { deployments } from '@common/db/schema';
import { appLogger } from '@common/logger';
import { eq } from 'drizzle-orm';
import type { DeploymentPhase } from '@common/types/deployment-status';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TargetSnapshotEntry {
	controllerId: string;
	name?: string;
	/** Semantic phase — installed/canceled/error/assigned/etc. */
	phase: DeploymentPhase;
	actionId?: number | null;
	actionType?: string;
	finalStatus?: string;
	/** True once the snapshot is frozen — read-only from then on. */
	frozen: boolean;
	snapshotAt: string;
}

export type TargetStatusSnapshot = Record<string, TargetSnapshotEntry>;

/** Phases that are terminal (success OR failure) — once reached, freeze. */
const TERMINAL_PHASES: ReadonlySet<DeploymentPhase> = new Set<DeploymentPhase>([
	'installed',
	'canceled',
	'error',
]);

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** Reads the snapshot for a deployment (by hawkBit DS ID). Empty if none. */
export async function getSnapshot(dsId: number): Promise<TargetStatusSnapshot> {
	try {
		const [row] = await db
			.select({ snapshot: deployments.targetStatusSnapshot })
			.from(deployments)
			.where(eq(deployments.hawkbitDsId, dsId))
			.limit(1);
		const snap = row?.snapshot as TargetStatusSnapshot | null | undefined;
		return snap && typeof snap === 'object' ? snap : {};
	} catch (err: any) {
		appLogger.debug('[SNAPSHOT] Failed to read snapshot for DS %d: %s', dsId, err?.message ?? 'unknown');
		return {};
	}
}

/** True if the target is frozen (snapshot is final and must not be overwritten). */
export function isTargetFrozen(
	snapshot: TargetStatusSnapshot,
	controllerId: string,
): boolean {
	return snapshot[controllerId]?.frozen === true;
}

/** True if the target has reached installed phase (sticky-success). */
export function isTargetInstalled(
	snapshot: TargetStatusSnapshot,
	controllerId: string,
): boolean {
	return snapshot[controllerId]?.phase === 'installed';
}

// ---------------------------------------------------------------------------
// Write — upsert with STICKY-FINISHED protection
// ---------------------------------------------------------------------------

/**
 * Updates a single target's snapshot entry. Respects the sticky rule: a frozen
 * 'installed' is NEVER overwritten; other frozen terminal phases only upgrade
 * to 'installed' (late feedback) — never downgraded.
 */
export async function updateTargetSnapshot(
	dsId: number,
	controllerId: string,
	partial: Omit<TargetSnapshotEntry, 'controllerId' | 'snapshotAt' | 'frozen'> & {
		frozen?: boolean;
	},
): Promise<TargetSnapshotEntry | null> {
	const snapshot = await getSnapshot(dsId);
	const existing = snapshot[controllerId];

	// STICKY: frozen 'installed' is never overwritten.
	if (existing?.frozen && existing.phase === 'installed') {
		appLogger.debug('[SNAPSHOT] DS %d target %s frozen-installed — ignoring phase=%s', dsId, controllerId, partial.phase);
		return existing;
	}

	const incomingPhase = partial.phase;
	const shouldFreeze = existing?.frozen || (partial.frozen ?? false) || TERMINAL_PHASES.has(incomingPhase);

	// STICKY: frozen terminal phase (non-assigned) only upgrades to installed.
	if (existing?.frozen && existing.phase !== 'assigned' && incomingPhase !== 'installed') {
		appLogger.debug('[SNAPSHOT] DS %d target %s frozen=%s — keeping (ignoring %s)', dsId, controllerId, existing.phase, incomingPhase);
		return existing;
	}

	const entry: TargetSnapshotEntry = {
		controllerId,
		name: partial.name ?? existing?.name,
		phase: incomingPhase,
		actionId: partial.actionId ?? existing?.actionId ?? null,
		actionType: partial.actionType ?? existing?.actionType,
		finalStatus: partial.finalStatus ?? existing?.finalStatus,
		frozen: shouldFreeze,
		snapshotAt: new Date().toISOString(),
	};

	const updated = { ...snapshot, [controllerId]: entry };
	await persistSnapshot(dsId, updated);
	return entry;
}

/**
 * Marks a target as CANCELED — but ONLY if it is not already 'installed'.
 * Implements the user requirement: a device that already reported finished
 * must remain finished even when the deployment is later cancelled.
 *
 * Use this when:
 *  - User cancels the deployment via DELETE /actions/{id}.
 *  - Sync detects the action was superseded by a newer DS (action disappeared).
 */
export async function freezeTargetAsCanceledIfNotInstalled(
	dsId: number,
	controllerId: string,
	actionId?: number,
): Promise<void> {
	const snapshot = await getSnapshot(dsId);
	const existing = snapshot[controllerId];

	// STICKY: keep installed devices as installed.
	if (existing?.phase === 'installed') {
		appLogger.info(
			'[SNAPSHOT] DS %d target %s remains installed (ignoring cancel — preserves tracking)',
			dsId, controllerId,
		);
		return;
	}

	await updateTargetSnapshot(dsId, controllerId, {
		phase: 'canceled',
		actionId: actionId ?? existing?.actionId ?? null,
		actionType: 'cancel',
		finalStatus: 'canceled',
		frozen: true,
	});
}

/**
 * Freezes a target as successfully installed (terminal-success).
 * Idempotent — once installed, always installed.
 */
export async function freezeTargetAsInstalled(
	dsId: number,
	controllerId: string,
	actionId?: number,
): Promise<void> {
	await updateTargetSnapshot(dsId, controllerId, {
		phase: 'installed',
		actionId: actionId ?? null,
		actionType: 'update',
		finalStatus: 'finished',
		frozen: true,
	});
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function persistSnapshot(dsId: number, snapshot: TargetStatusSnapshot): Promise<void> {
	try {
		await db
			.update(deployments)
			.set({ targetStatusSnapshot: snapshot as any, updatedAt: new Date() })
			.where(eq(deployments.hawkbitDsId, dsId));
	} catch (err: any) {
		// Non-fatal: snapshot is best-effort history. Don't break sync/cancel flows.
		appLogger.warn(
			'[SNAPSHOT] Failed to persist snapshot for DS %d: %s',
			dsId, err?.message ?? 'unknown',
		);
	}
}

/** Bulk-replaces the entire snapshot (used by sync engine after a full pass). */
export async function replaceSnapshot(
	dsId: number,
	snapshot: TargetStatusSnapshot,
): Promise<void> {
	// Respect sticky-finished: do not overwrite existing frozen 'installed' entries.
	const existing = await getSnapshot(dsId);
	const merged: TargetStatusSnapshot = { ...snapshot };
	for (const [cid, entry] of Object.entries(existing)) {
		if (entry.phase === 'installed' && entry.frozen) {
			// Preserve sticky-installed unless the incoming snapshot also has installed.
			if (merged[cid]?.phase !== 'installed') {
				merged[cid] = entry;
			}
		}
	}
	await persistSnapshot(dsId, merged);
}

/**
 * Freezes a target's snapshot when it reaches a terminal phase, called from
 * the sync engine after each action-status poll. Respects the sticky rule:
 * installed is never overwritten by a later cancel.
 */
export async function freezeOnTerminalPhase(
	dsId: number,
	controllerId: string,
	phase: DeploymentPhase,
	actionId: number,
	actionType: string,
	rawStatus: string,
): Promise<void> {
	if (phase === 'installed') {
		await freezeTargetAsInstalled(dsId, controllerId, actionId);
	} else if (phase === 'canceled') {
		await freezeTargetAsCanceledIfNotInstalled(dsId, controllerId, actionId);
	} else if (phase === 'error') {
		await updateTargetSnapshot(dsId, controllerId, {
			phase: 'error',
			actionId,
			actionType,
			finalStatus: rawStatus,
			frozen: true,
		});
	}
}
