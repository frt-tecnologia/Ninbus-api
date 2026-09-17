import { db } from '@common/db';
import { deployments, user } from '@common/db/schema';
import {
	type NinbusArtifactType,
	hawkbitDistributionSets,
} from '@common/hawkbit/client';
import { appLogger } from '@common/logger';
import { eq } from 'drizzle-orm';

import {
	type LocalDeploymentRecord,
	computeDeploymentStatus,
	enrichDeployment,
	enrichOrphanedDeployment,
	summarizeStatistics,
} from './enrichment';
export { deleteDeployment, requireDeploymentOwnership } from './delete';
import { requireDeploymentOwnership } from './delete';
export { getDeploymentTargetStatuses, getTargetStatusTrail } from './trail';
export type { TargetDeploymentStatus, TargetStatusTrail } from './trail';
export { checkDDiReadiness, type DdiDiagnosticResult } from './ddi-diagnostics';
import { findSoftwareModule, getLocalDeployment, resolveHawkbitTargetIds } from './helpers';
import { deploySoftwareModuleToTargets } from './deploy';

export { deploySoftwareModuleToTargets, verifySoftwareModuleHasArtifacts } from './deploy';

export type { EnrichedDeployment, DeploymentStatisticsSummary } from './enrichment';
export { computeDeploymentStatus, enrichDeployment, summarizeStatistics } from './enrichment';

// ---------------------------------------------------------------------------
// Error classes (defined in ./errors to avoid a circular import with delete.ts)
// ---------------------------------------------------------------------------

export { DeploymentNotFoundError } from './errors';

// ---------------------------------------------------------------------------
// CRUD — all scoped by companyId
// ---------------------------------------------------------------------------

export interface CreateDeploymentInput {
	name: string;
	artifactName: string;
	artifactType: NinbusArtifactType;
	version?: string;
	deviceIds?: string[];
	categoryIds?: string[];
	allDevices?: boolean;
}

export async function createDeployment(
	companyId: string,
	userId: string,
	data: CreateDeploymentInput,
) {
	const targetIds = await resolveHawkbitTargetIds(companyId, {
		deviceIds: data.deviceIds,
		categoryIds: data.categoryIds,
		allDevices: data.allDevices,
	});

	if (targetIds.length === 0) {
		throw new Error('No eligible devices found for deployment');
	}

	const sm = await findSoftwareModule(companyId, data.artifactName, data.version, data.artifactType);
	if (!sm) {
		throw new Error(
			`Artifact "${data.artifactName}" (${data.artifactType}) not found. ` +
				'Upload the artifact first via POST /artifacts before creating a deployment.',
		);
	}

	// Shared execution: DS creation, target assignment, DDI verification,
	// local audit record. See ./deploy — also used by the factory firmware flow.
	return deploySoftwareModuleToTargets(companyId, userId, sm, data.artifactType, data.name, targetIds);
}

/** Get deployment — verify ownership first. Enriched with local audit data. */
export async function getDeployment(companyId: string, dsId: number) {
	await requireDeploymentOwnership(companyId, dsId);
	const local = await getLocalDeployment(dsId);
	return enrichDeployment(await hawkbitDistributionSets.get(dsId), local ?? undefined);
}

export async function getDeploymentStatistics(dsId: number) {
	const raw = await hawkbitDistributionSets.getStatistics(dsId);
	const statsMap = raw.actions || {};
	const total = raw.actions?.['total'] || 0;
	return {
		raw,
		summary: summarizeStatistics(statsMap),
		status: computeDeploymentStatus(statsMap, total, { dsId }),
	};
}

/** List deployments for a specific company (like getCompanyDevices).
 *  Uses local DB as source of truth — hawkBit enrichment is optional.
 *  Orphaned deployments (DS deleted) show audit data from local records.
 */
export async function listDeployments(
	companyId: string,
	_params?: { offset?: number; limit?: number },
) {
	// 1. Get local deployment records for this company (with creator email)
	let localDeployments: any[];
	try {
		localDeployments = await db
			.select({
				id: deployments.id,
				name: deployments.name,
				hawkbitDsId: deployments.hawkbitDsId,
				artifactType: deployments.artifactType,
				artifactName: deployments.artifactName,
				artifactVersion: deployments.artifactVersion,
				artifactOriginalFile: deployments.artifactOriginalFile,
				targetCount: deployments.targetCount,
				targetIds: deployments.targetIds,
				createdBy: deployments.createdBy,
				creatorEmail: user.email,
				createdAt: deployments.createdAt,
				updatedAt: deployments.updatedAt,
			})
			.from(deployments)
			.leftJoin(user, eq(deployments.createdBy, user.id))
			.where(eq(deployments.companyId, companyId));
	} catch (dbError: any) {
		appLogger.error('[DEPLOYMENTS] DB query failed: %s', dbError?.message ?? 'unknown');
		return { data: [], total: 0 };
	}

	if (localDeployments.length === 0) {
		return { data: [], total: 0 };
	}

	// 2. Try to fetch DS data from hawkBit
	const dsIds = localDeployments.map((d: any) => d.hawkbitDsId);

	let hawkbitDSs: any[] = [];
	try {
		hawkbitDSs = await hawkbitDistributionSets.listByIds(dsIds);
	} catch (hbError: any) {
		appLogger.warn('[DEPLOYMENTS] hawkBit unavailable: %s', hbError?.message ?? 'unknown');
		// hawkBit down — return all from local records as orphaned
		const enriched = localDeployments.map((local) => enrichOrphanedDeployment(local));
		return { data: enriched, total: enriched.length };
	}

	// 3. Enrich: all DSes from hawkBit (incl. soft-deleted) + orphaned from local
	//    DB. NOT filtering `!ds.deleted` — soft-deleted DSes + local snapshot keep
	//    history. The old filter made cancelled deployments vanish from the list.
	const hawkbitMap = new Map(hawkbitDSs.map((ds: any) => [ds.id, ds]));
	const enriched = await Promise.all(
		localDeployments.map(async (local) => {
			const hawkbitDS = hawkbitMap.get(local.hawkbitDsId);
			return hawkbitDS
				? enrichDeployment(hawkbitDS, local as LocalDeploymentRecord)
				: enrichOrphanedDeployment(local as LocalDeploymentRecord);
		}),
	);
	return { data: enriched, total: enriched.length };
}

export async function getDeploymentTargets(
	dsId: number,
	params?: { offset?: number; limit?: number },
) {
	return hawkbitDistributionSets.getAssignedTargets(dsId, params);
}
