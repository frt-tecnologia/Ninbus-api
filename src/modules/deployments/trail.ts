/**
 * Deployment Status Trail — Full action status history for targets.
 *
 * Provides enriched timeline data for device deployment status,
 * parsing download progress and semantic phases from hawkBit
 * action status entries.
 */
import { db } from '@common/db';
import { deployments } from '@common/db/schema';
import { hawkbitDistributionSets, hawkbitTargets } from '@common/hawkbit/client';
import { appLogger } from '@common/logger';
import { eq } from 'drizzle-orm';
import type { DeploymentPhase } from '@common/types/deployment-status';
import { getSnapshot } from './snapshot';
import { resolveActionStatus } from './trail-helpers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Single target's deployment status within a specific DS. */
export interface TargetDeploymentStatus {
	controllerId: string;
	name: string;
	updateStatus: string;
	/** The action for this DS (null if target was never assigned or action was cleaned up). */
	action: {
		id: number;
		type: string;
		active: boolean;
		status: string;
		createdAt?: number;
		/** Semantic phase computed from latest status entry. */
		phase: DeploymentPhase;
		/** Latest download progress (0-100) or null. */
		progress: number | null;
		/** Primary message from latest status entry. */
		message: string;
	} | null;
}

/** Full status trail for a target — the timeline of all status entries. */
export interface TargetStatusTrail {
	controllerId: string;
	name: string;
	actionId: number;
	actionType: string;
	actionStatus: string;
	active: boolean;
	phase: DeploymentPhase;
	progress: number | null;
	currentMessage: string;
	/** Chronological timeline (oldest → newest) of enriched status entries. */
	trail: EnrichedActionStatus[];
}

// ---------------------------------------------------------------------------
// Batch: All targets in a deployment with their current status
// ---------------------------------------------------------------------------

/**
 * Get all targets assigned to a DS with their current deployment status.
 *
 * Source of truth for the target list is the LOCAL DB audit record
 * (`deployments.target_ids`), because hawkBit's `getAssignedTargets` only
 * returns targets whose CURRENT assignment is this DS. When a target is
 * later re-assigned to a newer DS, it disappears from the old DS's list —
 * making historical deployments appear empty.
 *
 * For each historical target, we query the action specific to THIS DS via
 * RSQL filter `distributionSet.id=={dsId}` (not the target's most recent
 * action, which may belong to a different DS).
 */
export async function getDeploymentTargetStatuses(
	dsId: number,
	options?: { offset?: number; limit?: number },
): Promise<{ content: TargetDeploymentStatus[]; total: number }> {
	// 1. Resolve target IDs: local DB first (historical truth), fallback to hawkBit current.
	let controllerIds: string[] | null = null;
	try {
		const [local] = await db
			.select({ targetIds: deployments.targetIds })
			.from(deployments)
			.where(eq(deployments.hawkbitDsId, dsId))
			.limit(1);
		if (local?.targetIds) {
			try {
				const parsed = JSON.parse(local.targetIds);
				if (Array.isArray(parsed)) controllerIds = parsed.filter((x) => typeof x === 'string');
			} catch { /* malformed JSON — fall through to hawkBit */ }
		}
	} catch (dbErr: any) {
		appLogger.warn('[TRAIL] Failed to read local target_ids for DS %d: %s', dsId, dbErr?.message ?? 'unknown');
	}

	// Fallback: no local record → use hawkBit current assignment (best effort).
	if (!controllerIds || controllerIds.length === 0) {
		const targetsResult = await hawkbitDistributionSets.getAssignedTargets(dsId, {
			offset: options?.offset ?? 0,
			limit: options?.limit ?? 100,
		});
		controllerIds = targetsResult.content.map((t) => t.controllerId);
	}

	// 2. Apply pagination to the resolved historical list.
	const total = controllerIds.length;
	const offset = options?.offset ?? 0;
	const limit = options?.limit ?? 100;
	const page = controllerIds.slice(offset, offset + limit);

	// 3. Load the frozen snapshot ONCE for this DS — used to preserve history
	//    for targets whose hawkBit action was cancelled/superseded.
	const snapshot = await getSnapshot(dsId);

	// 4. For each target, fetch info + the action specific to THIS DS.
	const result: TargetDeploymentStatus[] = await Promise.all(
		page.map(async (controllerId): Promise<TargetDeploymentStatus> => {
			let name = controllerId;
			let updateStatus = 'unknown';
			try {
				const target = await hawkbitTargets.get(controllerId);
				name = target.name;
				updateStatus = target.updateStatus ?? 'unknown';
			} catch { /* target may have been deleted — keep controllerId as name */ }

			// FROZEN SNAPSHOT SHORTCIRCUIT: if this target has a frozen snapshot entry,
			// use it directly — the hawkBit action may have disappeared (cancelled /
			// superseded) but the Ninbus history is preserved. This is what keeps
			// cancelled devices visible in old deployments.
			const frozenEntry = snapshot[controllerId];
			if (frozenEntry?.frozen) {
				return {
					controllerId,
					name: frozenEntry.name ?? name,
					updateStatus,
					action: {
						id: frozenEntry.actionId ?? 0,
						type: frozenEntry.actionType ?? 'update',
						active: false,
						status: frozenEntry.finalStatus ?? frozenEntry.phase,
						phase: frozenEntry.phase,
						progress: null,
						message: frozenEntry.finalStatus ?? frozenEntry.phase,
					},
				};
			}

			let actionInfo: TargetDeploymentStatus['action'] = null;
			try {
				const actionsForDs = await hawkbitTargets.getActions(controllerId, {
					q: `distributionSet.id==${dsId}`, sort: 'id:DESC', limit: 5,
				});
				const match = actionsForDs.content.find((a) => a.type === 'update') ?? actionsForDs.content[0] ?? null;
				if (match) actionInfo = await resolveActionStatus(controllerId, match);
			} catch (err: any) {
				appLogger.debug('[TRAIL] actions query failed for %s DS %d: %s', controllerId, dsId, err?.message ?? 'unknown');
			}
			return { controllerId, name, updateStatus, action: actionInfo };
		}),
	);
	return { content: result, total };
}

// ---------------------------------------------------------------------------
// Single: Full status trail for one target's action
// ---------------------------------------------------------------------------

/**
 * Get the full status trail (timeline) for a specific target's action.
 * Returns enriched entries with phase, progress, and display message.
 *
 * If actionId is not provided, finds the latest update action for the target.
 */
export async function getTargetStatusTrail(
	controllerId: string,
	actionId?: number,
): Promise<TargetStatusTrail | null> {
	let targetActionId = actionId;

	// If no actionId, find the latest update action
	if (!targetActionId) {
		const actions = await hawkbitTargets.getActions(controllerId, {
			limit: 10,
			sort: 'id:DESC',
		});
		const updateAction = actions.content.find((a) => a.type === 'update');
		if (!updateAction) return null;
		targetActionId = updateAction.id;
	}

	// Get target info for name
	const target = await hawkbitTargets.get(controllerId);

	// Get the action
	const action = await hawkbitTargets.getAction(controllerId, targetActionId);

	// Get full status history
	const statusResult = await hawkbitTargets.getActionStatus(controllerId, targetActionId);

	// Enrich all status entries and reverse to chronological order
	const trail = statusResult.content
		.map(enrichActionStatus)
		.reverse(); // oldest → newest

	// Compute current phase and progress from latest entry
	const latest = statusResult.content[0];
	const phase = latest ? enrichActionStatus(latest).phase : 'unknown';
	const progress = getLatestProgress(statusResult.content);
	const currentMessage = latest
		? (latest.messages?.join(' ') ?? latest.type)
		: action.status;

	return {
		controllerId: target.controllerId,
		name: target.name,
		actionId: action.id,
		actionType: action.type,
		actionStatus: action.status,
		active: action.active,
		phase,
		progress,
		currentMessage,
		trail,
	};
}

// ---------------------------------------------------------------------------
// Helpers
//---------------------------------------------------------------------------
// resolveActionStatus moved to ./trail-helpers.ts (file size limit).
