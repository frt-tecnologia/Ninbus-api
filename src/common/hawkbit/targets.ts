/**
 * hawkBit Target API — CRUD, attributes, actions, assignments.
 * Replaces Mender Device Auth + Inventory + Device Connect.
 */
import { hawkbitRequest } from './http';
import type {
	HawkbitAction,
	HawkbitActionStatus,
	HawkbitDistributionSet,
	HawkbitPagedResponse,
	HawkbitTarget,
	HawkbitTargetAttributes,
	HawkbitTargetRequestBody,
} from './types';

export const hawkbitTargets = {
	list(params?: { offset?: number; limit?: number; sort?: string; q?: string }): Promise<
		HawkbitPagedResponse<HawkbitTarget>
	> {
		return hawkbitRequest({
			method: 'GET',
			path: '/rest/v1/targets',
			query: params,
		});
	},

	get(targetId: string): Promise<HawkbitTarget> {
		return hawkbitRequest({
			method: 'GET',
			path: `/rest/v1/targets/${encodeURIComponent(targetId)}`,
		});
	},

	create(
		data: HawkbitTargetRequestBody | HawkbitTargetRequestBody[],
	): Promise<HawkbitTarget[]> {
		return hawkbitRequest<HawkbitTarget[]>({
			method: 'POST',
			path: '/rest/v1/targets',
			body: Array.isArray(data) ? data : [data],
		});
	},

	update(targetId: string, data: Partial<HawkbitTargetRequestBody>): Promise<void> {
		return hawkbitRequest({
			method: 'PUT',
			path: `/rest/v1/targets/${encodeURIComponent(targetId)}`,
			body: data,
		});
	},

	delete(targetId: string): Promise<void> {
		return hawkbitRequest({
			method: 'DELETE',
			path: `/rest/v1/targets/${encodeURIComponent(targetId)}`,
		});
	},

	getAttributes(targetId: string): Promise<HawkbitTargetAttributes> {
		return hawkbitRequest({
			method: 'GET',
			path: `/rest/v1/targets/${encodeURIComponent(targetId)}/attributes`,
		});
	},

	getActions(
		targetId: string,
		params?: { offset?: number; limit?: number; sort?: string; q?: string },
	): Promise<HawkbitPagedResponse<HawkbitAction>> {
		return hawkbitRequest({
			method: 'GET',
			path: `/rest/v1/targets/${encodeURIComponent(targetId)}/actions`,
			query: params,
		});
	},

	getAction(targetId: string, actionId: number): Promise<HawkbitAction> {
		return hawkbitRequest({
			method: 'GET',
			path: `/rest/v1/targets/${encodeURIComponent(targetId)}/actions/${actionId}`,
		});
	},

	/**
	 * Force-quit an action immediately — skips the two-step cancel process.
	 *
	 * Used for cancel-type actions (which can't be "cancelled" again) and for
	 * any action that needs immediate closure without waiting for DDI feedback.
	 *
	 * hawkBit's two-step cancel process requires:
	 *   Step 1: DELETE /actions/{id} → transitions to "canceling"
	 *   Step 2: DELETE /actions/{id}?force=true → force-quits (only after step 1)
	 *
	 * But for CANCEL-type actions, step 1 FAILS (you can't cancel a cancel).
	 * The action is already in "canceling" state, so we can go directly to
	 * step 2 (force-quit) without step 1.
	 */
	async forceQuitAction(targetId: string, actionId: number): Promise<void> {
		// First try step 1 (cancel request) — may fail for cancel-type actions
		try {
			await hawkbitRequest({
				method: 'DELETE',
				path: `/rest/v1/targets/${encodeURIComponent(targetId)}/actions/${actionId}`,
			});
		} catch {
			// Cancel-type actions can't be cancelled — that's expected.
			// The action is already in "canceling" state, proceed to force-quit.
		}

		// Step 2: Force-quit — always attempt regardless of step 1 result.
		// This works on actions in "canceling" state (cancel-type or post-step-1).
		try {
			await hawkbitRequest({
				method: 'DELETE',
				path: `/rest/v1/targets/${encodeURIComponent(targetId)}/actions/${actionId}`,
				query: { force: true },
			});
		} catch {
			// Already force-quit or not applicable — that's fine
		}
	},

	/**
	 * Cancel an action for a target using the two-step process.
	 *
	 * hawkBit requires:
	 *   1. DELETE /actions/{id} (no force) → creates cancel action, status becomes "canceling"
	 *   2. DELETE /actions/{id}?force=true → only works AFTER step 1, force-quits the action
	 *
	 * For cancel-type actions or when force-immediate closure is needed,
	 * use forceQuitAction() instead — it handles both action types correctly.
	 *
	 * IMPORTANT: When force=true, this method ALWAYS attempts step 2 regardless
	 * of step 1's result. This ensures cancel-type actions are properly closed.
	 */
	async cancelAction(targetId: string, actionId: number, force?: boolean): Promise<void> {
		// Step 1: Request cancel (no force) — hawkBit creates cancel action
		try {
			await hawkbitRequest({
				method: 'DELETE',
				path: `/rest/v1/targets/${encodeURIComponent(targetId)}/actions/${actionId}`,
			});
		} catch {
			// When force=true, always proceed to step 2 regardless of step 1 error.
			// Cancel-type actions can't be "cancelled" (step 1 fails), but they CAN
			// be force-quit (step 2). Previously we re-threw here, which prevented
			// cancel actions from being force-closed. This was the root cause of
			// the DDI deploymentBase blocking bug.
			if (force !== true) {
				throw new Error(
					`Failed to cancel action #${actionId} for target ${targetId}. ` +
					'Use forceQuitAction() for cancel-type actions or pass force=true.',
				);
			}
		}

		// Step 2: Force quit (only if requested) — completes the cancel immediately
		// Without this, the action stays in "canceling" state until the device
		// acknowledges the cancel via DDI feedback. Since our devices don't
		// implement cancel feedback, force=true is required for immediate effect.
		if (force !== false) {
			try {
				await hawkbitRequest({
					method: 'DELETE',
				path: `/rest/v1/targets/${encodeURIComponent(targetId)}/actions/${actionId}`,
					query: { force: true },
				});
			} catch {
				// Already force-quit or force not applicable — that's fine
			}
		}
	},

	cancelAllActions(targetId: string, keepLast?: number): Promise<void> {
		return hawkbitRequest({
			method: 'DELETE',
			path: `/rest/v1/targets/${encodeURIComponent(targetId)}/actions`,
			query: { keepLast },
		});
	},

	getActionStatus(
		targetId: string,
		actionId: number,
		params?: { offset?: number; limit?: number },
	): Promise<HawkbitPagedResponse<HawkbitActionStatus>> {
		return hawkbitRequest({
			method: 'GET',
			path: `/rest/v1/targets/${encodeURIComponent(targetId)}/actions/${actionId}/status`,
			query: params,
		});
	},

	getAssignedDS(targetId: string): Promise<HawkbitDistributionSet[]> {
		return hawkbitRequest({
			method: 'GET',
			path: `/rest/v1/targets/${encodeURIComponent(targetId)}/assignedDS`,
		});
	},

	assignDS(
		targetId: string,
		dsId: number,
		params?: { type?: 'forced' | 'soft' | 'timeforced' | 'downloadonly'; offline?: boolean },
	): Promise<void> {
		return hawkbitRequest({
			method: 'POST',
			path: `/rest/v1/targets/${encodeURIComponent(targetId)}/assignedDS`,
			query: { offline: params?.offline },
			// hawkBit expects 'type' (not 'forceType'). Default is 'forced'.
			body: { id: dsId, type: params?.type ?? 'forced' },
		});
	},
};
