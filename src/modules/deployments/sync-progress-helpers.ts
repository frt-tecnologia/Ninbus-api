/**
 * Sync Progress helpers — DS resolution, final events, deployment stats.
 * Split from sync-progress.ts to keep both files under 250 lines.
 */
import { db } from '@common/db';
import { deployments } from '@common/db/schema';
import { hawkbitTargets, hawkbitDistributionSets } from '@common/hawkbit/client';
import { appLogger } from '@common/logger';
import { sseEmitter } from '@common/sse';
import { enrichActionStatus, getLatestProgress } from '@common/types/deployment-status-helpers';
import type { ChangedDevice } from '@modules/devices/sync-helpers';
import { summarizeStatistics, computeDeploymentStatus } from './enrichment';
import { eq, desc } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// DS ID resolution — uses local DB
// ---------------------------------------------------------------------------

/** Resolve active DS IDs for a company from local DB (most recent first). */
export async function getCompanyDsIds(companyId: string): Promise<number[]> {
	try {
		const rows = await db
			.select({ hawkbitDsId: deployments.hawkbitDsId })
			.from(deployments)
			.where(eq(deployments.companyId, companyId))
			.orderBy(desc(deployments.createdAt))
			.limit(10);
		return rows.map((r) => r.hawkbitDsId);
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// Final event: emit when device leaves pending state
// ---------------------------------------------------------------------------

/**
 * For devices that WERE pending last cycle but are no longer,
 * emit one final action status event so Flutter gets the terminal state.
 */
export async function emitFinalEvents(
	nonPendingChanged: ChangedDevice[],
	previouslyPending: Map<string, { companyId: string; deviceId: string }>,
): Promise<void> {
	// Only process devices that were in previouslyPending
	const toFinalize: ChangedDevice[] = [];
	for (const d of nonPendingChanged) {
		if (previouslyPending.has(d.controllerId)) {
			toFinalize.push(d);
		}
	}
	if (toFinalize.length === 0) return;

	appLogger.debug('[SYNC-PROGRESS] Emitting final events for %d device(s)', toFinalize.length);

	for (const d of toFinalize) {
		try {
			const actions = await hawkbitTargets.getActions(d.controllerId, { limit: 5, sort: 'id:DESC' });
			const updateAction = actions.content.find((a) => a.type === 'update');
			if (!updateAction) continue;

			const statusResult = await hawkbitTargets.getActionStatus(d.controllerId, updateAction.id, { limit: 5 });
			if (statusResult.content.length === 0) continue;

			const latest = statusResult.content[0]!;
			const enriched = enrichActionStatus(latest);
			const progress = getLatestProgress(statusResult.content);

			sseEmitter.emit(d.companyId, 'device.action.status', {
				deviceId: d.deviceId,
				controllerId: d.controllerId,
				actionId: updateAction.id,
				latestStatus: latest.type,
				phase: enriched.phase,
				progress,
				message: enriched.displayMessage,
				timestamp: new Date().toISOString(),
			});
		} catch (error: any) {
			appLogger.debug('[SYNC-PROGRESS] Final event failed for %s: %s', d.controllerId, error?.message ?? 'unknown');
		} finally {
			previouslyPending.delete(d.controllerId);
		}
	}
}

// ---------------------------------------------------------------------------
// Deployment statistics: emit aggregate stats
// ---------------------------------------------------------------------------

export async function emitDeploymentStatsForDs(dsIds: Set<number>, companyId: string): Promise<void> {
	for (const dsId of dsIds) {
		try {
			const raw = await hawkbitDistributionSets.getStatistics(dsId);
			const statsMap = raw.actions || {};
			const total = raw.actions?.['total'] || 0;
			sseEmitter.emit(companyId, 'deployment.stats', {
				deploymentId: dsId,
				summary: summarizeStatistics(statsMap),
				status: computeDeploymentStatus(statsMap, total, { dsId }),
			});
		} catch (error: any) {
			appLogger.debug('[SYNC-PROGRESS] Stats failed for DS #%d: %s', dsId, error?.message ?? 'unknown');
		}
	}
}
