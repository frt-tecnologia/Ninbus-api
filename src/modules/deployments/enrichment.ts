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
	/** User-visible deployment name extracted from DS description. */
	displayName?: string;
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
	options?: { dsDeleted?: boolean; dsId?: number },
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

	let status: DeploymentStatusType;

	// All targets completed successfully
	if (finished === total) {
		status = 'completed';
	} else if (error > 0) {
		// Any error → deployment has failures
		status = 'failed';
	} else if (canceled === total) {
		// All canceled
		status = 'canceled';
	} else if (inProgress > 0) {
		// Some targets still working
		status = 'in_progress';
	} else if (pending > 0) {
		// Scheduled but not started
		status = 'pending';
	} else {
		// Fallback: anything with targets but no clear terminal state
		// This can happen when hawkBit reports total=N but 0 actions in any known status.
		// Example: actions just created but statistics not yet updated.
		// Treat as pending (action exists, device hasn't reported yet).
		status = 'pending';
	}

	appLogger.debug(
		`[DEPLOY] DS #${options?.dsId ?? '?'} status computation: ${status} ` +
		`(total=${total}, finished=${finished}, error=${error}, canceled=${canceled}, ` +
		`inProgress=${inProgress}, pending=${pending}, raw=${JSON.stringify(statsMap)})`,
	);

	return status;
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
// Display name extraction
// ---------------------------------------------------------------------------

/** Extract user-visible deployment name from DS description. Format: "{name} | artifact: ..." */
function extractDeploymentDisplayName(ds: HawkbitDistributionSet): string | undefined {
	const desc = ds.description ?? '';
	const match = desc.match(/^([^|]+)\|/);
	return match ? match[1]!.trim() : undefined;
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
	let statsFetchFailed = false;

	try {
		const stats: HawkbitDSStatistics = await hawkbitDistributionSets.getStatistics(ds.id);
		statsMap = stats.actions || {};
		total = stats.actions?.['total'] || 0;
		appLogger.debug(
			`[DEPLOY] DS #${ds.id} raw stats: ${JSON.stringify(stats)}`,
		);
	} catch (e) {
		statsFetchFailed = true;
		appLogger.warn(
			'[DEPLOY] Could not fetch statistics for DS %d (will use fallback): %s',
			ds.id,
			e instanceof Error ? e.message : String(e),
		);
	}

	return {
		id: ds.id,
		name: ds.name,
		displayName: extractDeploymentDisplayName(ds),
		version: ds.version,
		type: ds.type,
		typeName: ds.typeName,
		description: ds.description,
		createdAt: ds.createdAt,
		lastModifiedAt: ds.lastModifiedAt,
		status: statsFetchFailed
			? 'unknown' as DeploymentStatusType
			: computeDeploymentStatus(statsMap, total, { dsDeleted: ds.deleted, dsId: ds.id }),
		statistics: summarizeStatistics(statsMap),
		dsMetadata: {
			locked: ds.locked ?? false,
			complete: ds.complete ?? false,
			valid: ds.valid ?? false,
		},
	};
}
