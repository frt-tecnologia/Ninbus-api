/**
 * Deployment action management — cancel, force-close, cleanup, DDI diagnostics.
 *
 * hawkBit action lifecycle:
 *   1. DS assigned to target → action created (status=running)
 *   2. Device polls DDI → action status=retrieved
 *   3. Device downloads/installs → action status=download/downloaded
 *   4. Device sends feedback → action status=finished
 *
 * Cancel flow (TWO-STEP in hawkBit):
 *   Step 1: DELETE /actions/{id} → creates cancel action (status=canceling)
 *   Step 2: DELETE /actions/{id}?force=true → force-quits (only works after step 1)
 *
 * CRITICAL INSIGHT: When a new DS is assigned to a target that has an active
 * update action, hawkBit auto-creates a cancel action for the old one.
 * This cancel action stays in "canceling" until the device acknowledges via DDI.
 * hawkBit PRIORITIZES cancelAction over deploymentBase in DDI responses.
 * If the device doesn't implement cancel feedback, the cancel action blocks
 * the new deployment from being offered.
 *
 * Solution: force-close only CANCEL-type actions AFTER assignment.
 */
import { hawkbitDistributionSets, hawkbitTargets } from '@common/hawkbit/client';
import { appLogger } from '@common/logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max retries for force-close operations. */
const FORCE_CLOSE_RETRIES = 3;
/** Delay between retries in ms. */
const FORCE_CLOSE_RETRY_DELAY_MS = 500;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Force-close active actions for a single target.
 *
 * When onlyCancel=true, uses forceQuitAction() for cancel-type actions
 * and skips update-type actions (preserves new deployment).
 *
 * CRITICAL: Cancel-type actions MUST use forceQuitAction() instead of cancelAction().
 * cancelAction() step 1 (DELETE /actions/{id} without force) FAILS for cancel-type
 * actions because you can't "cancel a cancel". Previously this caused step 2
 * (force-quit) to be skipped, leaving cancel actions active and blocking
 * deploymentBase in DDI responses.
 */
async function forceCloseTargetActions(
	targetId: string,
	options?: { onlyCancel?: boolean },
): Promise<void> {
	const actions = await hawkbitTargets.getActions(targetId, { limit: 100 });
	const toClose = actions.content.filter((a) => {
		if (!a.active) return false;
		if (options?.onlyCancel && a.type !== 'cancel') return false;
		return true;
	});

	for (const action of toClose) {
		let closed = false;
		for (let attempt = 1; attempt <= FORCE_CLOSE_RETRIES; attempt++) {
			try {
				if (action.type === 'cancel') {
					await hawkbitTargets.forceQuitAction(targetId, action.id);
				} else {
					await hawkbitTargets.cancelAction(targetId, action.id, true);
				}
				closed = true;
				appLogger.info(
					'[DEPLOY] Force-closed action #%d (type=%s, status=%s) for target %s (attempt %d)',
					action.id, action.type, action.status, targetId, attempt,
				);
				break;
			} catch (e) {
				appLogger.warn(
					'[DEPLOY] Attempt %d/%d failed for action #%d (type=%s) target %s: %s',
					attempt, FORCE_CLOSE_RETRIES, action.id, action.type, targetId,
					e instanceof Error ? e.message : String(e),
				);
				if (attempt < FORCE_CLOSE_RETRIES) {
					await delay(FORCE_CLOSE_RETRY_DELAY_MS * attempt);
				}
			}
		}

		if (!closed) {
			appLogger.error(
				`[DEPLOY] FAILED to force-close action #${action.id} (type=${action.type}) for target ${targetId} after ${FORCE_CLOSE_RETRIES} attempts. ` +
				'This action may block DDI deploymentBase!',
			);
		}
	}

	// Verify: check if any actions are still active after force-close
	if (toClose.length > 0) {
		await delay(200); // Brief pause for hawkBit to process
		const recheck = await hawkbitTargets.getActions(targetId, { limit: 100 });
		const stillActive = recheck.content.filter((a) => {
			if (!a.active) return false;
			if (options?.onlyCancel && a.type !== 'cancel') return false;
			return true;
		});
		if (stillActive.length > 0) {
			appLogger.error(
				{
					targetId,
					count: stillActive.length,
					actions: stillActive.map((a) => `#${a.id}(${a.type}/${a.status})`),
				},
				'[DEPLOY] BUG: actions STILL ACTIVE after force-close. This will block DDI deploymentBase!',
			);
		} else {
			appLogger.debug(
				'[DEPLOY] Verified: all target actions closed for %s', targetId,
			);
		}
	}
}

// ---------------------------------------------------------------------------
// Public API: Force-close operations
// ---------------------------------------------------------------------------

/**
 * Force-close ALL active actions for a list of targets.
 * Used BEFORE assigning a new DS to clean up pre-existing actions.
 */
export async function forceCloseActiveActions(targetIds: string[]): Promise<void> {
	for (const targetId of targetIds) {
		try {
			await forceCloseTargetActions(targetId);
		} catch (e) {
			appLogger.debug('[DEPLOY] Could not clean actions for %s: %s', targetId, e);
		}
	}
}

/**
 * Force-close only active CANCEL actions for a list of targets.
 * Used AFTER assigning a new DS to clean up auto-created cancel actions
 * without touching the new update action.
 *
 * hawkBit returns cancelAction (priority) over deploymentBase in DDI.
 * Without this, the device sees cancelAction instead of the new deployment.
 */
export async function forceCloseCancelActions(targetIds: string[]): Promise<void> {
	for (const targetId of targetIds) {
		try {
			await forceCloseTargetActions(targetId, { onlyCancel: true });
		} catch (e) {
			appLogger.debug('[DEPLOY] Could not clean cancel actions for %s: %s', targetId, e);
		}
	}
}

/**
 * Cancel all active actions for all targets assigned to a DS.
 * Paginates through all assigned targets and force-closes their actions.
 *
 * CRITICAL: hawkBit DS deletion does NOT cancel active actions.
 * This function must be called BEFORE deleting a DS, otherwise
 * devices keep receiving deploymentBase via DDI with an orphaned action.
 */
export async function forceCloseActiveActionsForDS(dsId: number): Promise<void> {
	const pageSize = 500;
	let offset = 0;
	let hasMore = true;

	while (hasMore) {
		const targets = await hawkbitDistributionSets.getAssignedTargets(dsId, {
			offset,
			limit: pageSize,
		});

		for (const target of targets.content) {
			try {
				await forceCloseTargetActions(target.controllerId);
			} catch (e) {
				appLogger.warn(
					'[DEPLOY] Could not cancel actions for target %s (DS #%d): %s',
					target.controllerId, dsId,
					e instanceof Error ? e.message : String(e),
				);
			}
		}

		offset += targets.content.length;
		hasMore = targets.content.length >= pageSize;
	}
}

// ---------------------------------------------------------------------------
// Public API: DDI Diagnostics
// ---------------------------------------------------------------------------

export { checkDDiReadiness, type DdiDiagnosticResult } from './ddi-diagnostics';
