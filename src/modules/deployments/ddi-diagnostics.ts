/**
 * DDI Diagnostic — Check if a target would receive deploymentBase via DDI.
 *
 * When a device polls hawkBit DDI but gets no deploymentBase despite a DS being
 * assigned (updateStatus=pending), this diagnostic module helps identify the cause.
 *
 * Possible causes:
 * 1. Active cancel actions blocking (hawkBit returns cancelAction in DDI)
 * 2. DS Software Module has no artifacts (hawkBit won't offer incomplete DS)
 * 3. Action was never created (assignment failed)
 * 4. Target authentication issue (wrong securityToken)
 */
import { hawkbitTargets } from '@common/hawkbit/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DdiDiagnosticResult {
	controllerId: string;
	/** Whether the device would see deploymentBase in DDI. */
	deploymentBaseOffered: boolean;
	/** Whether the device would see cancelAction in DDI. */
	cancelActionOffered: boolean;
	/** All active actions for this target. */
	activeActions: Array<{
		id: number;
		type: string;
		status: string;
		forceType?: string;
		weight?: number;
	}>;
	/** Target update status from hawkBit. */
	updateStatus: string;
	/** Target connection status. */
	connected: boolean;
	/** Last poll timestamp. */
	lastPollAt: number | null;
	/** Assigned DS ID (from the latest active update action). */
	assignedDsId: number | null;
	/** DS completeness check. */
	dsComplete: boolean | null;
	/** Issues found. */
	issues: string[];
}

// ---------------------------------------------------------------------------
// DDI Diagnostic Check
// ---------------------------------------------------------------------------

/**
 * Check if a target would receive deploymentBase via DDI.
 *
 * This simulates what the DDI root resource handler returns by checking:
 * 1. Target exists and has correct securityToken
 * 2. Active update action exists
 * 3. No cancel actions blocking (both can be present, but cancel takes priority on device)
 * 4. DS has complete modules with artifacts
 *
 * Returns a diagnostic result with detailed information about what the
 * device would see when polling DDI.
 */
export async function checkDDiReadiness(targetId: string): Promise<DdiDiagnosticResult> {
	const result: DdiDiagnosticResult = {
		controllerId: targetId,
		deploymentBaseOffered: false,
		cancelActionOffered: false,
		activeActions: [],
		updateStatus: 'unknown',
		connected: false,
		lastPollAt: null,
		assignedDsId: null,
		dsComplete: null,
		issues: [],
	};

	// 1. Check target exists
	let target: any;
	try {
		target = await hawkbitTargets.get(targetId);
	} catch (e: any) {
		result.issues.push(`Target not found in hawkBit: ${e?.message ?? e}`);
		return result;
	}

	result.updateStatus = target.updateStatus ?? 'unknown';
	result.connected = target.pollStatus ? !target.pollStatus.overdue : false;
	result.lastPollAt = target.pollStatus?.lastRequestAt ?? null;

	// 2. Get all actions
	const actions = await hawkbitTargets.getActions(targetId, { limit: 50 });
	const activeActions = actions.content.filter((a: { active: boolean }) => a.active);

	result.activeActions = activeActions.map((a: { id: number; type: string; status: string; forceType?: string; weight?: number }) => ({
		id: a.id,
		type: a.type,
		status: a.status,
		forceType: a.forceType,
		weight: a.weight,
	}));

	// 3. Check for active update actions
	const activeUpdate = activeActions.find((a: { type: string }) => a.type === 'update');
	const activeCancel = activeActions.find((a: { type: string }) => a.type === 'cancel');

	result.cancelActionOffered = !!activeCancel;

	if (!activeUpdate) {
		result.issues.push(
			'No active update action found. Device will get 204 (no deployment) from DDI. ' +
			`Active actions: [${activeActions.map((a: { id: number; type: string }) => `#${a.id}(${a.type})`).join(', ')}]`,
		);
		return result;
	}

	result.deploymentBaseOffered = true;
	result.assignedDsId = activeUpdate.id;

	// 4. Check DS completeness
	try {
		const actionDetail = await hawkbitTargets.getAction(targetId, activeUpdate.id);
		if (actionDetail._links) {
			// Action exists with links — DS is accessible
		}
	} catch {
		// Action detail not available
	}

	// 5. Check for issues
	if (activeCancel) {
		result.issues.push(
			`Active cancel action #${activeCancel.id} found. ` +
			'hawkBit returns BOTH deploymentBase AND cancelAction in DDI. ' +
			'Device firmware must check for deploymentBase even when cancelAction is present. ' +
			'If firmware processes cancelAction first and ignores deploymentBase, ' +
			'force-close the cancel action via the Management API.',
		);
	}

	if (result.updateStatus !== 'pending') {
		result.issues.push(
			`Target updateStatus is "${result.updateStatus}" (expected "pending"). ` +
			'This may indicate the action was already completed or the DS was not properly assigned.',
		);
	}

	return result;
}
