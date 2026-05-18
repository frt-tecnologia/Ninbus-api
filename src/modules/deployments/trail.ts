/**
 * Deployment Status Trail — Full action status history for targets.
 *
 * Provides enriched timeline data for device deployment status,
 * parsing download progress and semantic phases from hawkBit
 * action status entries.
 */
import { hawkbitDistributionSets, hawkbitTargets } from '@common/hawkbit/client';
import type { EnrichedActionStatus, DeploymentPhase } from '@common/types/deployment-status';
import {
	enrichActionStatus,
	getLatestProgress,
} from '@common/types/deployment-status-helpers';

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
 * For each target, finds the latest update action and computes:
 * - semantic phase (downloading, installing, etc.)
 * - download progress (0-100%)
 * - latest status message
 */
export async function getDeploymentTargetStatuses(
	dsId: number,
	options?: { offset?: number; limit?: number },
): Promise<{ content: TargetDeploymentStatus[]; total: number }> {
	const targetsResult = await hawkbitDistributionSets.getAssignedTargets(dsId, {
		offset: options?.offset ?? 0,
		limit: options?.limit ?? 100,
	});

	const result: TargetDeploymentStatus[] = [];

	for (const target of targetsResult.content) {
		// Get actions for this target — find the latest update action
		const actions = await hawkbitTargets.getActions(target.controllerId, {
			limit: 20,
			sort: 'id:DESC',
		});

		// Prefer active update action, fallback to any update action
		const updateAction = actions.content.find(
			(a) => a.type === 'update' && a.active,
		) ?? actions.content.find(
			(a) => a.type === 'update',
		);

		let actionInfo: TargetDeploymentStatus['action'] = null;
		if (updateAction) {
			actionInfo = await resolveActionStatus(target.controllerId, updateAction);
		}

		result.push({
			controllerId: target.controllerId,
			name: target.name,
			updateStatus: target.updateStatus ?? 'unknown',
			action: actionInfo,
		});
	}

	return { content: result, total: targetsResult.total };
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
// ---------------------------------------------------------------------------

/**
 * Resolve the enriched status for a single action.
 * Fetches action status history and computes phase + progress.
 */
async function resolveActionStatus(
	controllerId: string,
	action: { id: number; type: string; active: boolean; status: string; createdAt?: number },
): Promise<NonNullable<TargetDeploymentStatus['action']>> {
	try {
		const statusList = await hawkbitTargets.getActionStatus(controllerId, action.id);
		const latest = statusList.content[0];
		if (latest) {
			const enriched = enrichActionStatus(latest);
			const progress = getLatestProgress(statusList.content);
			return {
				id: action.id,
				type: action.type,
				active: action.active,
				status: action.status,
				createdAt: action.createdAt,
				phase: enriched.phase,
				progress,
				message: enriched.displayMessage,
			};
		}
	} catch {
		// Status not available yet — fall through
	}

	return {
		id: action.id,
		type: action.type,
		active: action.active,
		status: action.status,
		createdAt: action.createdAt,
		phase: action.active ? 'assigned' : 'unknown',
		progress: null,
		message: action.status,
	};
}
