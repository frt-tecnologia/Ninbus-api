/**
 * Trail helpers — shared utilities for deployment status trail resolution.
 *
 * Extracted from trail.ts to keep it under the 250-line limit. Pure logic with
 * no DB access — receives the action descriptor and fetches enriched status.
 */
import { hawkbitTargets } from '@common/hawkbit/client';
import { enrichActionStatus, getLatestProgress } from '@common/types/deployment-status-helpers';

/** Shape of the per-target action block returned by the trail endpoints. */
export interface TargetActionInfo {
	id: number;
	type: string;
	active: boolean;
	status: string;
	createdAt?: number;
	phase: string;
	progress: number | null;
	message: string;
}

/**
 * Resolve the enriched status for a single action.
 * Fetches action status history and computes phase + progress.
 *
 * Falls back to a sensible default when hawkBit has no status entries yet
 * (action just created, device hasn't polled).
 */
export async function resolveActionStatus(
	controllerId: string,
	action: { id: number; type: string; active: boolean; status: string; createdAt?: number },
): Promise<TargetActionInfo> {
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
