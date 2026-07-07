/**
 * Deployment enrichment — status computation and hawkBit statistics helpers.
 *
 * `enrichDeployment` accepts an optional local DB record, which is the source of
 * truth for historical data (artifactVersion, targetIds, targetCount): hawkBit's
 * `assignedTargets` only reflects the CURRENT assignment, so targets re-assigned
 * to a newer DS vanish from old DS lists. Without the local merge, old
 * deployments show 0 targets.
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
	/** User-visible name (local audit name preferred over DS description parsing). */
	displayName?: string;
	/** Artifact version (semantic, e.g. "2.1.0"). Falls back to DS version if no local record. */
	version?: string;
	type?: string;
	typeName?: string;
	description?: string;
	createdAt?: number;
	lastModifiedAt?: number;
	status: DeploymentStatusType;
	statistics: DeploymentStatisticsSummary;
	dsMetadata: { locked: boolean; complete: boolean; valid: boolean };
	/** Audit fields (survive artifact deletion / DS re-assignment). */
	artifactName?: string;
	artifactVersion?: string;
	artifactOriginalFile?: string;
	targetCount?: number;
	/** hawkBit controllerIds assigned at deployment time — source of truth for
	 *  historical target lists (hawkBit assignedTargets only reflects CURRENT assignment). */
	targetIds?: string[];
	/** Who created the deployment (super-admin observability). */
	createdBy?: string | null;
	creatorEmail?: string | null;
}

// ---------------------------------------------------------------------------
// Local record type (matches deployments table columns)
// ---------------------------------------------------------------------------

export interface LocalDeploymentRecord {
	id: string;
	name: string;
	hawkbitDsId: number;
	artifactType: string;
	artifactName: string | null;
	artifactVersion: string | null;
	artifactOriginalFile: string | null;
	targetCount: number | null;
	targetIds: string | null;
	createdBy: string | null;
	creatorEmail?: string | null;
	createdAt: Date;
	updatedAt: Date;
}

/** Parse a JSON-encoded target_ids column into a string array (defensive). */
function parseTargetIds(raw: string | null | undefined): string[] | undefined {
	if (!raw) return undefined;
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : undefined;
	} catch {
		return undefined;
	}
}

// ---------------------------------------------------------------------------
// Statistics → Status computation
// ---------------------------------------------------------------------------

/** Compute deployment status from hawkBit action statistics.
 *  Stats keys are UPPERCASE action status types (normalized to lowercase).
 *  Priority: failed > in_progress > pending > completed > canceled > no_targets. */
export function computeDeploymentStatus(
	statsMap: Record<string, number>,
	total: number,
	options?: { dsDeleted?: boolean; dsId?: number },
): DeploymentStatusType {
	if (options?.dsDeleted) return 'canceled';
	if (total === 0) return 'no_targets';

	const n: Record<string, number> = {};
	for (const [key, value] of Object.entries(statsMap)) n[key.toLowerCase()] = value;

	const finished = n['finished'] || 0;
	const error = (n['error'] || 0) + (n['warning'] || 0);
	const canceled = (n['canceled'] || 0) + (n['canceling'] || 0);
	const inProgress = (n['retrieved'] || 0) + (n['download'] || 0) + (n['downloaded'] || 0);
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
		// Fallback: anything with targets but no clear terminal state.
		// Can happen when hawkBit reports total=N but 0 actions in any known status
		// (e.g. actions just created but statistics not yet updated).
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
// Display name extraction + Orphaned deployment fallback
// ---------------------------------------------------------------------------
/** Extract user-visible deployment name from DS description. Format: "{name} | artifact: ..." */
function extractDeploymentDisplayName(ds: HawkbitDistributionSet): string | undefined {
	const desc = ds.description ?? '';
	const match = desc.match(/^([^|]+)\|/);
	return match ? match[1]!.trim() : undefined;
}

/** Enrich an orphaned deployment (DS deleted in hawkBit) using local DB data only.
 *  Preserves full audit history after artifact deletion. */
/**
 * hawkBit DS-type keys are prefixed 'ninbus-' (e.g. 'ninbus-firmware-ninbus').
 * Strip the prefix to recover the canonical artifact-type key, so the frontend
 * filter values ('firmware-ninbus', etc.) match. If the prefix is absent,
 * return the value as-is.
 */
function stripDsTypePrefix(dsType?: string): string | undefined {
	if (!dsType) return undefined;
	return dsType.startsWith('ninbus-') ? dsType.slice('ninbus-'.length) : dsType;
}

export function enrichOrphanedDeployment(local: LocalDeploymentRecord): EnrichedDeployment {
	const targetCount = local.targetCount ?? 0;
	return {
		id: local.hawkbitDsId,
		name: local.name,
		displayName: local.name,
		/** The canonical artifact type from the local record. */
		type: local.artifactType,
		/** version = artifact version (semantic), not hawkBit's internal DS version. */
		version: local.artifactVersion ?? undefined,
		status: 'completed' as DeploymentStatusType,
		statistics: { totalTargets: targetCount, finished: targetCount, failed: 0, inProgress: 0, pending: 0, canceled: 0 },
		dsMetadata: { locked: false, complete: true, valid: true },
		artifactName: local.artifactName ?? undefined,
		artifactVersion: local.artifactVersion ?? undefined,
		artifactOriginalFile: local.artifactOriginalFile ?? undefined,
		targetCount: targetCount || undefined,
		targetIds: parseTargetIds(local.targetIds),
		createdBy: local.createdBy ?? null,
		creatorEmail: local.creatorEmail ?? null,
		createdAt: local.createdAt.getTime(),
		lastModifiedAt: local.updatedAt.getTime(),
	};
}

// ---------------------------------------------------------------------------
// Enrichment: DS → EnrichedDeployment (with optional local DB merge)
// ---------------------------------------------------------------------------

/** Enrich a raw hawkBit DS with real status from the statistics endpoint.
 *
 *  If `local` is provided, audit fields (artifactName, artifactVersion, targetCount,
 *  targetIds, displayName) are merged from the local DB record. This is REQUIRED for
 *  correct historical data — hawkBit's assignedTargets only reflects the CURRENT
 *  assignment, so targets later re-assigned vanish from old DS lists. */
export async function enrichDeployment(
	ds: HawkbitDistributionSet,
	local?: LocalDeploymentRecord,
): Promise<EnrichedDeployment> {
	let statsMap: Record<string, number> = {};
	let total = 0;
	let statsFetchFailed = false;

	try {
		const stats: HawkbitDSStatistics = await hawkbitDistributionSets.getStatistics(ds.id);
		statsMap = stats.actions || {};
		total = stats.actions?.['total'] || 0;
		appLogger.debug(`[DEPLOY] DS #${ds.id} raw stats: ${JSON.stringify(stats)}`);
	} catch (e) {
		statsFetchFailed = true;
		appLogger.warn('[DEPLOY] Statistics fetch failed for DS %d: %s', ds.id, e instanceof Error ? e.message : String(e));
	}

	return {
		id: ds.id,
		name: ds.name,
		displayName: local?.name ?? extractDeploymentDisplayName(ds),
		/** version = artifact version (semantic). DS.version is an internal timestamp. */
		version: local?.artifactVersion ?? ds.version,
		/**
		 * type = canonical Ninbus artifact type key (e.g. 'firmware-ninbus').
		 * The local DB record is the source of truth — it's validated at the
		 * API schema level (Union of 3 literals). The hawkBit DS `type` field is
		 * the DS-type KEY ('ninbus-firmware-ninbus'), which does NOT match the
		 * artifact-type enum the frontend filters on. Without this preference,
		 * deployments appear with a type the API doesn't expose, which looks
		 * like a data-integrity bug.
		 */
		type: local?.artifactType ?? stripDsTypePrefix(ds.type),
		typeName: ds.typeName,
		description: ds.description,
		createdAt: ds.createdAt,
		lastModifiedAt: ds.lastModifiedAt,
		status: statsFetchFailed
			? 'unknown' as DeploymentStatusType
			: computeDeploymentStatus(statsMap, total, { dsDeleted: ds.deleted, dsId: ds.id }),
		statistics: summarizeStatistics(statsMap),
		dsMetadata: { locked: ds.locked ?? false, complete: ds.complete ?? false, valid: ds.valid ?? false },
		artifactName: local?.artifactName ?? undefined,
		artifactVersion: local?.artifactVersion ?? undefined,
		artifactOriginalFile: local?.artifactOriginalFile ?? undefined,
		targetCount: local?.targetCount ?? undefined,
		targetIds: parseTargetIds(local?.targetIds),
		createdBy: local?.createdBy ?? null,
		creatorEmail: local?.creatorEmail ?? null,
	};
}
