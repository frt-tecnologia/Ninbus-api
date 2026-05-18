/**
 * Deployment status helpers — parsing, enrichment, and phase computation.
 *
 * Pure functions that transform raw hawkBit action status entries
 * into semantic phases with download progress for the frontend.
 */
import type { HawkbitActionStatusType, DeploymentPhase, EnrichedActionStatus } from './deployment-status';

// ---------------------------------------------------------------------------
// Message Detection
// ---------------------------------------------------------------------------

/** Parse download progress percentage from a hawkBit action status message. */
export function parseDownloadProgress(message: string): number | null {
	if (!message) return null;
	const lower = message.toLowerCase();
	if (lower.includes('download complete') || lower.includes('downloaded')) return 100;
	const match = lower.match(/downloading\s+(\d+)%/);
	if (match) return parseInt(match[1]!, 10);
	return null;
}

export function isInstallMessage(message: string): boolean {
	if (!message) return false;
	const lower = message.toLowerCase();
	return lower.includes('installing') || lower.includes('staging') || lower.includes('staged');
}

export function isDownloadMessage(message: string): boolean {
	if (!message) return false;
	const lower = message.toLowerCase();
	return lower.includes('downloading') || lower.includes('download');
}

export function isAssignmentMessage(message: string): boolean {
	if (!message) return false;
	return message.toLowerCase().includes('assignment initiated');
}

export function isRetrievedMessage(message: string): boolean {
	if (!message) return false;
	return message.toLowerCase().includes('retrieved');
}

// ---------------------------------------------------------------------------
// Phase Computation
// ---------------------------------------------------------------------------

/** Map raw hawkBit action status type → base semantic phase (no message context). */
export function actionStatusToPhase(status: HawkbitActionStatusType): DeploymentPhase {
	switch (status) {
		case 'retrieved': return 'retrieved';
		case 'download': return 'downloading';
		case 'downloaded': return 'downloaded';
		case 'running': return 'installing';
		case 'finished': return 'success';
		case 'error':
		case 'warning':
		case 'cancel_rejected': return 'error';
		case 'canceled':
		case 'canceling': return 'canceled';
		case 'scheduled':
		case 'wait_for_confirmation': return 'assigned';
		default: return 'unknown';
	}
}

/**
 * Compute enriched status from a single hawkBit action status entry.
 * Uses message content to distinguish phases within the same hawkBit type.
 */
export function enrichActionStatus(entry: {
	id: number;
	type: HawkbitActionStatusType;
	messages?: string[];
	reportedAt?: number;
}): EnrichedActionStatus {
	const msg = entry.messages?.join(' ') ?? '';
	const progress = parseDownloadProgress(msg);

	let phase: DeploymentPhase;
	if (entry.type === 'running') {
		if (isDownloadMessage(msg)) {
			phase = 'downloading';
		} else if (isAssignmentMessage(msg)) {
			phase = 'assigned';
		} else if (isRetrievedMessage(msg)) {
			phase = 'retrieved';
		} else if (isInstallMessage(msg)) {
			phase = 'installing';
		} else if (msg.toLowerCase().includes('deployment started')) {
			phase = 'installing';
		} else {
			phase = 'installing';
		}
	} else if (entry.type === 'finished') {
		phase = msg.toLowerCase().includes('reboot') ? 'rebooting' : 'success';
	} else {
		phase = actionStatusToPhase(entry.type);
	}

	return {
		id: entry.id,
		type: entry.type,
		messages: entry.messages ?? [],
		reportedAt: entry.reportedAt ?? null,
		progress,
		phase,
		displayMessage: msg || entry.type,
	};
}

/**
 * Compute the latest phase from an action status history array (desc order).
 * Uses message content to detect download progress vs install vs rebooting.
 */
export function computeLatestPhase(
	statusHistory: { type: HawkbitActionStatusType; messages?: string[] }[],
): DeploymentPhase {
	if (!statusHistory || statusHistory.length === 0) return 'unknown';
	const latest = statusHistory[0]!;
	const msg = latest.messages?.join(' ') ?? '';

	if (latest.type === 'running') {
		if (isDownloadMessage(msg)) return 'downloading';
		if (isAssignmentMessage(msg)) return 'assigned';
		if (isRetrievedMessage(msg)) return 'retrieved';
		if (isInstallMessage(msg)) return 'installing';

		const hasDownloaded = statusHistory.some(s => s.type === 'downloaded');
		if (hasDownloaded) return 'installing';
		const hasRetrieved = statusHistory.some(s => s.type === 'retrieved');
		if (!hasRetrieved) return 'assigned';
		return 'installing';
	}

	if (latest.type === 'finished') {
		return msg.toLowerCase().includes('reboot') ? 'rebooting' : 'success';
	}

	return actionStatusToPhase(latest.type);
}

/**
 * Get the latest download progress from an action status history (desc order).
 * Scans history for progress messages and returns the first (latest) match.
 */
export function getLatestProgress(
	statusHistory: { type: HawkbitActionStatusType; messages?: string[] }[],
): number | null {
	if (!statusHistory || statusHistory.length === 0) return null;
	for (const entry of statusHistory) {
		const progress = parseDownloadProgress(entry.messages?.join(' ') ?? '');
		if (progress !== null) return progress;
	}
	const hasDownload = statusHistory.some(s => s.type === 'download');
	return hasDownload ? 0 : null;
}
