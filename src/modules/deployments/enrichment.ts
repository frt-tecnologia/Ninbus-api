/**
 * Deployment enrichment — Status computation and hawkBit statistics helpers.
 *
 * Transforms raw hawkBit Distribution Set metadata into frontend-friendly
 * deployment status with real progress tracking from action statistics.
 */
import type { HawkbitDistributionSet, HawkbitDSStatistics } from '@common/hawkbit/client';
import { hawkbitDistributionSets } from '@common/hawkbit/client';
import { appLogger } from '@common/logger';
import type { DeploymentStatusType } from '@modules/deployments/schemas';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeploymentStatisticsSummary {
	totalTargets: number;
	finished: number;
	failed: number;
	inProgress: number;
	pending: number;
	canceled: number;
}

export interface EnrichedDeployment {
	id: number;
	name: string;
	version?: string;
	type?: string;
	typeName?: string;
	description?: string;
	createdAt?: number;
	lastModifiedAt?: number;
	status: DeploymentStatusType;
	statistics: DeploymentStatisticsSummary;
	dsMetadata: {
		locked: boolean;
		complete: boolean;
		valid: boolean;
	};
}

// ---------------------------------------------------------------------------
// Statistics → Status computation
// ---------------------------------------------------------------------------

/**
 * Compute deployment status from hawkBit action statistics.
 *
 * hawkBit statistics format (live):
 *   { "actions": { "RETRIEVED": 1, "total": 1 }, "rollouts": {...}, "totalAutoAssignments": 0 }
 *
 * Keys are UPPERCASE action status types. We normalize to lowercase for matching.
 *
 * Status priority: failed > in_progress > pending > completed > canceled > no_targets
 */
export function computeDeploymentStatus(
	statsMap: Record<string, number>,
	total: number,
	options?: { dsDeleted?: boolean },
): DeploymentStatusType {
	// Deleted DSes should not appear as active deployments
	if (options?.dsDeleted) return 'canceled';

	if (total === 0) return 'no_targets';

	// Normalize keys to lowercase
	const n: Record<string, number> = {};
	for (const [key, value] of Object.entries(statsMap)) {
		n[key.toLowerCase()] = value;
	}

	const finished = n['finished'] || 0;
	const error = (n['error'] || 0) + (n['warning'] || 0);
	const canceled = (n['canceled'] || 0) + (n['canceling'] || 0);
	const inProgress =
		(n['retrieved'] || 0) + (n['download'] || 0) + (n['downloaded'] || 0);
	const pending = (n['running'] || 0) + (n['scheduled'] || 0);

	// All targets completed successfully
	if (finished === total) return 'completed';

	// Any error → deployment has failures
	if (error > 0) return 'failed';

	// All canceled
	if (canceled === total) return 'canceled';

	// Some targets still working
	if (inProgress > 0) return 'in_progress';

	// Scheduled but not started
	if (pending > 0) return 'pending';

	// Fallback: anything with targets but no clear terminal state
	return 'in_progress';
}

/**
 * Summarize hawkBit action statistics into a frontend-friendly format.
 */
export function summarizeStatistics(
	statsMap: Record<string, number>,
): DeploymentStatisticsSummary {
	const n: Record<string, number> = {};
	for (const [key, value] of Object.entries(statsMap)) {
		n[key.toLowerCase()] = value;
	}

	return {
		totalTargets: n['total'] || 0,
		finished: n['finished'] || 0,
		failed: (n['error'] || 0) + (n['warning'] || 0),
		inProgress:
			(n['retrieved'] || 0) + (n['download'] || 0) + (n['downloaded'] || 0),
		pending: (n['running'] || 0) + (n['scheduled'] || 0),
		canceled: (n['canceled'] || 0) + (n['canceling'] || 0),
	};
}

// ---------------------------------------------------------------------------
// Enrichment: DS → EnrichedDeployment
// ---------------------------------------------------------------------------

/**
 * Enrich a raw hawkBit Distribution Set with real deployment status
 * fetched from the statistics endpoint.
 *
 * The DS properties `complete`/`valid`/`locked` are structural metadata
 * (e.g. "DS has all software modules"), NOT deployment status.
 * We move them to `dsMetadata` and compute the real status from actions.
 */
export async function enrichDeployment(ds: HawkbitDistributionSet): Promise<EnrichedDeployment> {
	let statsMap: Record<string, number> = {};
	let total = 0;

	try {
		const stats: HawkbitDSStatistics = await hawkbitDistributionSets.getStatistics(ds.id);
		statsMap = stats.actions || {};
		total = stats.actions?.['total'] || 0;
	} catch (e) {
		appLogger.debug(
			'[DEPLOY] Could not fetch statistics for DS %d: %s',
			ds.id,
			e instanceof Error ? e.message : String(e),
		);
	}

	return {
		id: ds.id,
		name: ds.name,
		version: ds.version,
		type: ds.type,
		typeName: ds.typeName,
		description: ds.description,
		createdAt: ds.createdAt,
		lastModifiedAt: ds.lastModifiedAt,
		status: computeDeploymentStatus(statsMap, total, { dsDeleted: ds.deleted }),
		statistics: summarizeStatistics(statsMap),
		dsMetadata: {
			locked: ds.locked ?? false,
			complete: ds.complete ?? false,
			valid: ds.valid ?? false,
		},
	};
}
