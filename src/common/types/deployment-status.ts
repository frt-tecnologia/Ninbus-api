/**
 * Deployment Action Status Types — lifecycle of a hawkBit OTA update.
 *
 * Maps EXACTLY to what the embedded Ninbus v3 device reports via DDI feedback
 * and what hawkBit stores as action status history.
 *
 * ═══════════════════════════════════════════════════════════════════════
 *  FULL LIFECYCLE (feedback from Ninbus v3 firmware via hawkBit DDI):
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  Step  DDI exec              hawkBit type  Message                            Phase
 *  ────  ──────────────────    ───────────   ─────────────────────────────────  ────────────
 *  0     (server-side)         running       "Assignment initiated by admin"    assigned
 *  1     (device poll)         retrieved     "Target retrieved update action"   pending
 *  2     proceeding            running       "deployment started"               installing
 *  3     download              download      "downloading artifact"             downloading
 *  4     proceeding            running       "downloading 25%"                  downloading(25%)
 *  5     proceeding            running       "downloading 50%"                  downloading(50%)
 *  6     proceeding            running       "downloading 75%"                  downloading(75%)
 *  7     downloaded            downloaded    "download complete"                downloaded(100%)
 *  8     proceeding            running       "installing NFX to controller"     installing
 *  9     closed+success        finished      "installed successfully"           installed
 *
 *  IMPORTANT: type='finished' ALWAYS means installed (success).
 *  hawkBit maps closed+failure → type='error', closed+success → type='finished'.
 *  See docs/hawkbit-status-flow-mapping.md for the full DDI feedback mapping.
 *
 * ═══════════════════════════════════════════════════════════════════════
 *  FIRMWARE-NINBUS SELF-UPDATE (STM32F407) — adds a REBOOT phase:
 * ═══════════════════════════════════════════════════════════════════════
 *  Step  DDI exec              hawkBit type  Message                                  Phase
 *  ────  ──────────────────    ───────────   ───────────────────────────────────────  ───────────
 *  R7    proceeding            running       "processing artifact"                    installing
 *  R8    proceeding            running       "staging firmware to NAND"               installing
 *  R9    proceeding            running       "firmware staged, rebooting to apply"    rebooting
 *        ── REBOOT (~15-40s: reset → bootloader → flash 0x08008000 → boot) ──
 *  R10a  closed+success        finished      "firmware installed successfully"        installed
 *  R10b  closed+failure        error         "firmware was not applied by bootloader" error
 *
 *  The 'rebooting' phase is the device's LAST feedback before it reboots.
 *  The UI must treat the R9→R10 gap as "reiniciando / aplicando" — NOT a stall.
 *  closed+success only arrives after the bootloader verified the new app's CRC
 *  (offset 1047) and jumped to it, so success == firmware truly updated.
 *  closed+failure means the bootloader rejected the image and kept the old app.
 *  Other failure messages (closed+failure → type='error'): "firmware CRC invalid",
 *  "firmware staging failed", "artifact processing failed", "download failed",
 *  "unknown artifact type".
 * ═══════════════════════════════════════════════════════════════════════
 */

// ---------------------------------------------------------------------------
// hawkBit Action Status Types (stored in action status history)
// ---------------------------------------------------------------------------

export const HAWKBIT_ACTION_STATUS_TYPES = [
	'retrieved', 'running', 'download', 'downloaded', 'finished',
	'error', 'warning', 'canceled', 'canceling', 'cancel_rejected',
	'scheduled', 'wait_for_confirmation',
] as const;

export type HawkbitActionStatusType = (typeof HAWKBIT_ACTION_STATUS_TYPES)[number];

// ---------------------------------------------------------------------------
// DDI Feedback Fields (what the device sends)
// ---------------------------------------------------------------------------

export const DDI_EXECUTION_STATUS = [
	'proceeding', 'canceled', 'scheduled', 'rejected', 'closed', 'downloaded',
] as const;
export type DdiExecutionStatus = (typeof DDI_EXECUTION_STATUS)[number];

export const DDI_RESULT_STATUS = ['none', 'success', 'failure'] as const;
export type DdiResultStatus = (typeof DDI_RESULT_STATUS)[number];

// ---------------------------------------------------------------------------
// Semantic Deployment Phase (what Flutter displays)
// ---------------------------------------------------------------------------

export const DEPLOYMENT_PHASE_VALUES = [
	'assigned', 'pending', 'downloading', 'downloaded', 'installing', 'rebooting',
	'installed', 'error', 'canceled', 'unknown',
] as const;
export type DeploymentPhase = (typeof DEPLOYMENT_PHASE_VALUES)[number];

// ---------------------------------------------------------------------------
// Enriched Action Status — raw hawkBit data + parsed progress and phase
// ---------------------------------------------------------------------------

export interface EnrichedActionStatus {
	id: number;
	type: HawkbitActionStatusType;
	messages: string[];
	reportedAt: number | null;
	/** Parsed download progress (0-100) or null. */
	progress: number | null;
	/** Semantic phase for UI. */
	phase: DeploymentPhase;
	/** Primary message for display. */
	displayMessage: string;
}

// ---------------------------------------------------------------------------
// SSE Event Types (what Flutter receives)
// ---------------------------------------------------------------------------

/** Device action status update pushed via SSE. */
export interface DeviceActionStatusEvent {
	deviceId: string;
	controllerId: string;
	actionId: number;
	latestStatus: HawkbitActionStatusType;
	phase: DeploymentPhase;
	progress: number | null;
	message: string;
	timestamp: string;
}

/** Deployment statistics update pushed via SSE. */
export interface DeploymentStatsEvent {
	deploymentId: number;
	summary: {
		totalTargets: number;
		finished: number;
		failed: number;
		inProgress: number;
		pending: number;
		canceled: number;
	};
	status: string;
}
