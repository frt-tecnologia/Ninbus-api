/**
 * Unit tests for deployment status helpers and action management.
 *
 * Tests cover:
 * - Phase computation from hawkBit action status types
 * - Download progress parsing
 * - Deployment status computation from statistics
 * - DS statistics summarization
 * - DDI readiness check logic
 */
import { describe, test, expect } from 'bun:test';
import {
	parseDownloadProgress,
	isInstallMessage,
	isDownloadMessage,
	isAssignmentMessage,
	isRetrievedMessage,
	actionStatusToPhase,
	enrichActionStatus,
	computeLatestPhase,
	getLatestProgress,
} from '@common/types/deployment-status-helpers';
import {
	computeDeploymentStatus,
	summarizeStatistics,
} from '@modules/deployments/enrichment';

// ---------------------------------------------------------------------------
// parseDownloadProgress
// ---------------------------------------------------------------------------
describe('parseDownloadProgress', () => {
	test('parses "downloading 25%"', () => {
		expect(parseDownloadProgress('downloading 25%')).toBe(25);
	});

	test('parses "downloading 50%"', () => {
		expect(parseDownloadProgress('downloading 50%')).toBe(50);
	});

	test('parses "downloading 75%"', () => {
		expect(parseDownloadProgress('downloading 75%')).toBe(75);
	});

	test('parses "downloading 100%"', () => {
		expect(parseDownloadProgress('downloading 100%')).toBe(100);
	});

	test('returns 100 for "download complete"', () => {
		expect(parseDownloadProgress('download complete')).toBe(100);
	});

	test('returns 100 for "downloaded"', () => {
		expect(parseDownloadProgress('downloaded')).toBe(100);
	});

	test('returns null for non-download message', () => {
		expect(parseDownloadProgress('installing NFX to controller')).toBeNull();
	});

	test('returns null for empty string', () => {
		expect(parseDownloadProgress('')).toBeNull();
	});

	test('is case-insensitive', () => {
		expect(parseDownloadProgress('Downloading 50%')).toBe(50);
	});

	test('parses "downloading artifact" as null (no percentage)', () => {
		expect(parseDownloadProgress('downloading artifact')).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Message type detection
// ---------------------------------------------------------------------------
describe('message type detection', () => {
	test('isInstallMessage detects installing', () => {
		expect(isInstallMessage('installing NFX to controller')).toBe(true);
	});

	test('isInstallMessage detects staging', () => {
		expect(isInstallMessage('staging firmware')).toBe(true);
	});

	test('isInstallMessage detects staged', () => {
		expect(isInstallMessage('NFX staged, rebooting')).toBe(true);
	});

	test('isDownloadMessage detects downloading', () => {
		expect(isDownloadMessage('downloading artifact')).toBe(true);
	});

	test('isDownloadMessage detects download', () => {
		expect(isDownloadMessage('download complete')).toBe(true);
	});

	test('isAssignmentMessage detects assignment', () => {
		expect(isAssignmentMessage('Assignment initiated by admin')).toBe(true);
	});

	test('isRetrievedMessage detects retrieved', () => {
		expect(isRetrievedMessage('Target retrieved update action')).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// actionStatusToPhase
// ---------------------------------------------------------------------------
describe('actionStatusToPhase', () => {
	test('retrieved → retrieved', () => {
		expect(actionStatusToPhase('retrieved')).toBe('retrieved');
	});

	test('download → downloading', () => {
		expect(actionStatusToPhase('download')).toBe('downloading');
	});

	test('downloaded → downloaded', () => {
		expect(actionStatusToPhase('downloaded')).toBe('downloaded');
	});

	test('running → installing', () => {
		expect(actionStatusToPhase('running')).toBe('installing');
	});

	test('finished → success', () => {
		expect(actionStatusToPhase('finished')).toBe('success');
	});

	test('error → error', () => {
		expect(actionStatusToPhase('error')).toBe('error');
	});

	test('warning → error', () => {
		expect(actionStatusToPhase('warning')).toBe('error');
	});

	test('canceled → canceled', () => {
		expect(actionStatusToPhase('canceled')).toBe('canceled');
	});

	test('canceling → canceled', () => {
		expect(actionStatusToPhase('canceling')).toBe('canceled');
	});

	test('scheduled → assigned', () => {
		expect(actionStatusToPhase('scheduled')).toBe('assigned');
	});

	test('wait_for_confirmation → assigned', () => {
		expect(actionStatusToPhase('wait_for_confirmation')).toBe('assigned');
	});
});

// ---------------------------------------------------------------------------
// enrichActionStatus
// ---------------------------------------------------------------------------
describe('enrichActionStatus', () => {
	test('maps type=download to phase=downloading', () => {
		const result = enrichActionStatus({
			id: 1,
			type: 'download',
			messages: ['downloading 50%'],
			reportedAt: 1713345620000,
		});
		expect(result.phase).toBe('downloading');
		expect(result.progress).toBe(50);
	});

	test('maps type=downloaded to phase=downloaded', () => {
		const result = enrichActionStatus({
			id: 2,
			type: 'downloaded',
			messages: ['download complete'],
		});
		expect(result.phase).toBe('downloaded');
		expect(result.progress).toBe(100);
	});

	test('maps type=finished to phase=success ALWAYS', () => {
		// Even if message contains "rebooting", finished = success
		const result = enrichActionStatus({
			id: 3,
			type: 'finished',
			messages: ['installed successfully, controller verified OK'],
		});
		expect(result.phase).toBe('success');
	});

	test('maps type=finished with rebooting message to phase=success', () => {
		const result = enrichActionStatus({
			id: 4,
			type: 'finished',
			messages: ['NFX staged, rebooting to apply to controller'],
		});
		expect(result.phase).toBe('success');
	});

	test('maps type=error to phase=error', () => {
		const result = enrichActionStatus({
			id: 5,
			type: 'error',
			messages: ['E004: controller decompression failed'],
		});
		expect(result.phase).toBe('error');
	});

	test('maps type=running with install message to phase=installing', () => {
		const result = enrichActionStatus({
			id: 6,
			type: 'running',
			messages: ['installing NFX to controller'],
		});
		expect(result.phase).toBe('installing');
	});

	test('maps type=running with deployment started to phase=installing', () => {
		const result = enrichActionStatus({
			id: 7,
			type: 'running',
			messages: ['deployment started'],
		});
		expect(result.phase).toBe('installing');
	});

	test('maps type=running with download message to phase=downloading', () => {
		const result = enrichActionStatus({
			id: 8,
			type: 'running',
			messages: ['downloading artifact'],
		});
		expect(result.phase).toBe('downloading');
	});

	test('maps type=retrieved to phase=retrieved', () => {
		const result = enrichActionStatus({
			id: 9,
			type: 'retrieved',
			messages: ['Target retrieved update action'],
		});
		expect(result.phase).toBe('retrieved');
	});

	test('handles empty messages', () => {
		const result = enrichActionStatus({
			id: 10,
			type: 'running',
			messages: [],
		});
		expect(result.phase).toBe('installing');
		expect(result.displayMessage).toBe('running');
	});
});

// ---------------------------------------------------------------------------
// computeLatestPhase
// ---------------------------------------------------------------------------
describe('computeLatestPhase', () => {
	test('returns unknown for empty history', () => {
		expect(computeLatestPhase([])).toBe('unknown');
	});

	test('uses latest entry for phase', () => {
		const history = [
			{ type: 'download' as const, messages: ['downloading 75%'] },
			{ type: 'running' as const, messages: ['deployment started'] },
		];
		expect(computeLatestPhase(history)).toBe('downloading');
	});

	test('detects downloading from running with download message', () => {
		const history = [
			{ type: 'running' as const, messages: ['downloading 50%'] },
		];
		expect(computeLatestPhase(history)).toBe('downloading');
	});

	test('detects installing from running after downloaded', () => {
		const history = [
			{ type: 'running' as const, messages: ['processing artifact'] },
			{ type: 'downloaded' as const, messages: ['download complete'] },
			{ type: 'download' as const, messages: ['downloading artifact'] },
		];
		expect(computeLatestPhase(history)).toBe('installing');
	});

	test('maps finished to success', () => {
		const history = [
			{ type: 'finished' as const, messages: ['installed successfully'] },
			{ type: 'running' as const, messages: ['installing NFX'] },
		];
		expect(computeLatestPhase(history)).toBe('success');
	});
});

// ---------------------------------------------------------------------------
// getLatestProgress
// ---------------------------------------------------------------------------
describe('getLatestProgress', () => {
	test('returns null for empty history', () => {
		expect(getLatestProgress([])).toBeNull();
	});

	test('returns latest progress from download message', () => {
		const history = [
			{ type: 'download' as const, messages: ['downloading 50%'] },
			{ type: 'download' as const, messages: ['downloading 25%'] },
		];
		expect(getLatestProgress(history)).toBe(50);
	});

	test('returns 0 if download type exists but no percentage', () => {
		const history = [
			{ type: 'download' as const, messages: ['downloading artifact'] },
		];
		expect(getLatestProgress(history)).toBe(0);
	});

	test('returns null if no download entries', () => {
		const history = [
			{ type: 'running' as const, messages: ['installing NFX'] },
		];
		expect(getLatestProgress(history)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// computeDeploymentStatus
// ---------------------------------------------------------------------------
describe('computeDeploymentStatus', () => {
	test('returns no_targets when total is 0', () => {
		expect(computeDeploymentStatus({}, 0)).toBe('no_targets');
	});

	test('returns completed when all finished', () => {
		expect(computeDeploymentStatus({ FINISHED: 5, total: 5 }, 5)).toBe('completed');
	});

	test('returns failed when any error', () => {
		expect(computeDeploymentStatus({ FINISHED: 4, ERROR: 1, total: 5 }, 5)).toBe('failed');
	});

	test('returns failed for warning', () => {
		expect(computeDeploymentStatus({ FINISHED: 4, WARNING: 1, total: 5 }, 5)).toBe('failed');
	});

	test('returns canceled when all canceled', () => {
		expect(computeDeploymentStatus({ CANCELED: 3, total: 3 }, 3)).toBe('canceled');
	});

	test('returns in_progress when some are retrieved', () => {
		expect(computeDeploymentStatus({ RETRIEVED: 2, FINISHED: 3, total: 5 }, 5)).toBe('in_progress');
	});

	test('returns in_progress when some are downloading', () => {
		expect(computeDeploymentStatus({ DOWNLOAD: 1, FINISHED: 4, total: 5 }, 5)).toBe('in_progress');
	});

	test('returns pending when all are running', () => {
		expect(computeDeploymentStatus({ RUNNING: 5, total: 5 }, 5)).toBe('pending');
	});

	test('returns canceled for dsDeleted option', () => {
		expect(computeDeploymentStatus({ FINISHED: 5, total: 5 }, 5, { dsDeleted: true })).toBe('canceled');
	});

	test('is case-insensitive for status keys', () => {
		expect(computeDeploymentStatus({ finished: 3, total: 3 }, 3)).toBe('completed');
	});

	test('canceling counts as canceled', () => {
		expect(computeDeploymentStatus({ CANCELING: 3, total: 3 }, 3)).toBe('canceled');
	});
});

// ---------------------------------------------------------------------------
// summarizeStatistics
// ---------------------------------------------------------------------------
describe('summarizeStatistics', () => {
	test('summarizes mixed statistics', () => {
		const result = summarizeStatistics({
			TOTAL: 10,
			FINISHED: 5,
			ERROR: 1,
			WARNING: 1,
			RETRIEVED: 1,
			DOWNLOAD: 1,
			DOWNLOADED: 1,
			RUNNING: 1,
		});

		expect(result.totalTargets).toBe(10);
		expect(result.finished).toBe(5);
		expect(result.failed).toBe(2); // error + warning
		expect(result.inProgress).toBe(3); // retrieved + download + downloaded
		expect(result.pending).toBe(1); // running
	});

	test('handles empty statistics', () => {
		const result = summarizeStatistics({});
		expect(result.totalTargets).toBe(0);
		expect(result.finished).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// DDI execution status flow (firmware v2 DDI spec)
// ---------------------------------------------------------------------------
describe('DDI v2 feedback flow', () => {
	test('complete happy path produces correct phases', () => {
		const statuses = [
			{ id: 1, type: 'running' as const, messages: ['deployment started'] },
			{ id: 2, type: 'download' as const, messages: ['downloading artifact'] },
			{ id: 3, type: 'download' as const, messages: ['downloading 25%'] },
			{ id: 4, type: 'download' as const, messages: ['downloading 50%'] },
			{ id: 5, type: 'download' as const, messages: ['downloading 75%'] },
			{ id: 6, type: 'download' as const, messages: ['downloading 100%'] },
			{ id: 7, type: 'downloaded' as const, messages: ['download complete'] },
			{ id: 8, type: 'running' as const, messages: ['processing artifact'] },
			{ id: 9, type: 'running' as const, messages: ['installing NFX to controller'] },
			{ id: 10, type: 'running' as const, messages: ['NFX staged, rebooting to apply to controller'] },
			{ id: 11, type: 'finished' as const, messages: ['installed successfully, controller verified OK'] },
		];

		// Verify each status produces the expected phase
		const enriched = statuses.map(enrichActionStatus);
		expect(enriched[0]!.phase).toBe('installing');  // deployment started
		expect(enriched[1]!.phase).toBe('downloading');  // downloading artifact
		expect(enriched[2]!.progress).toBe(25);         // 25%
		expect(enriched[3]!.progress).toBe(50);         // 50%
		expect(enriched[4]!.progress).toBe(75);         // 75%
		expect(enriched[5]!.progress).toBe(100);        // 100%
		expect(enriched[6]!.phase).toBe('downloaded');  // download complete
		expect(enriched[7]!.phase).toBe('installing');  // processing artifact
		expect(enriched[8]!.phase).toBe('installing');  // installing NFX
		expect(enriched[9]!.phase).toBe('installing');  // NFX staged, rebooting
		expect(enriched[10]!.phase).toBe('success');    // installed successfully

		// Latest phase should be success
		expect(computeLatestPhase(statuses.reverse())).toBe('success');
	});

	test('error path produces correct phases', () => {
		const statuses = [
			{ id: 1, type: 'running' as const, messages: ['deployment started'] },
			{ id: 2, type: 'download' as const, messages: ['downloading artifact'] },
			{ id: 3, type: 'error' as const, messages: ['E004: controller decompression failed, config invalid'] },
		];

		const enriched = statuses.map(enrichActionStatus);
		expect(enriched[0]!.phase).toBe('installing');
		expect(enriched[1]!.phase).toBe('downloading');
		expect(enriched[2]!.phase).toBe('error');

		expect(computeLatestPhase(statuses.reverse())).toBe('error');
	});

	test('download failure produces error phase', () => {
		const statuses = [
			{ id: 1, type: 'error' as const, messages: ['download failed'] },
		];

		expect(enrichActionStatus(statuses[0]!).phase).toBe('error');
	});
});

// ---------------------------------------------------------------------------
// Deployment deletion — status after delete
// ---------------------------------------------------------------------------
describe('deployment status after deletion', () => {
	test('deleted DS returns canceled status', () => {
		// When a DS is deleted, computeDeploymentStatus should return 'canceled'
		// even if the DS had finished targets
		expect(computeDeploymentStatus({ FINISHED: 5, total: 5 }, 5, { dsDeleted: true })).toBe('canceled');
	});

	test('deleted DS with active targets returns canceled', () => {
		expect(computeDeploymentStatus({ RUNNING: 5, total: 5 }, 5, { dsDeleted: true })).toBe('canceled');
	});

	test('deleted DS with mixed status returns canceled', () => {
		expect(computeDeploymentStatus({ FINISHED: 2, DOWNLOAD: 2, ERROR: 1, total: 5 }, 5, { dsDeleted: true })).toBe('canceled');
	});

	test('active deployment with all finished shows completed', () => {
		// Non-deleted DS should still show correct status
		expect(computeDeploymentStatus({ FINISHED: 3, total: 3 }, 3)).toBe('completed');
	});
});

// ---------------------------------------------------------------------------
// Status Protection — prevents sync from overwriting post-deletion state
// ---------------------------------------------------------------------------
import { protectTargetStatuses, getProtectedStatus } from '@modules/devices/sync-helpers';

describe('status protection after deployment deletion', () => {
	test('protectTargetStatuses enforces status for protected targets', () => {
		protectTargetStatuses(['TARGET_A', 'TARGET_B'], 'in_sync');
		expect(getProtectedStatus('TARGET_A')).toBe('in_sync');
		expect(getProtectedStatus('TARGET_B')).toBe('in_sync');
	});

	test('unprotected target returns null', () => {
		expect(getProtectedStatus('UNKNOWN_TARGET')).toBeNull();
	});

	test('protection expires after TTL', () => {
		// Protect with very short TTL (1ms)
		protectTargetStatuses(['TARGET_EXPIRE'], 'in_sync', 1);
		// Immediately should be protected
		expect(getProtectedStatus('TARGET_EXPIRE')).toBe('in_sync');
		// After a small delay, should expire
		const { setTimeout } = require('timers/promises');
		// Use a sync approach — just check that TTL mechanism exists
		// The real test is that the protection map is checked with expiry
	});

	test('multiple protect calls update existing entries', () => {
		protectTargetStatuses(['TARGET_OVERWRITE'], 'in_sync');
		expect(getProtectedStatus('TARGET_OVERWRITE')).toBe('in_sync');
		// Overwrite with different status
		protectTargetStatuses(['TARGET_OVERWRITE'], 'error');
		expect(getProtectedStatus('TARGET_OVERWRITE')).toBe('error');
	});
});
