import { db } from '@common/db';
import { artifacts, deployments } from '@common/db/schema';
import {
	type NinbusArtifactType,
	getOrCreateDistributionSetType,
	hawkbitDistributionSets,
	hawkbitSoftwareModules,
	hawkbitTargets,
} from '@common/hawkbit/client';
import { appLogger } from '@common/logger';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

import { enrichDeployment, enrichOrphanedDeployment, summarizeStatistics, computeDeploymentStatus } from './enrichment';
export { deleteDeployment, requireDeploymentOwnership } from './delete';
import { requireDeploymentOwnership } from './delete';
export { getDeploymentTargetStatuses, getTargetStatusTrail } from './trail';
export type { TargetDeploymentStatus, TargetStatusTrail } from './trail';
import { forceCloseActiveActions, forceCloseCancelActions } from './actions';
export { checkDDiReadiness, type DdiDiagnosticResult } from './ddi-diagnostics';
import { resolveHawkbitTargetIds, findSoftwareModule } from './helpers';

export type { EnrichedDeployment, DeploymentStatisticsSummary } from './enrichment';
export { computeDeploymentStatus, enrichDeployment, summarizeStatistics } from './enrichment';

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class DeploymentNotFoundError extends Error {
	constructor(message = 'Deployment not found') {
		super(message);
		this.name = 'DeploymentNotFoundError';
	}
}

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

export async function createDeployment(companyId: string, userId: string, data: CreateDeploymentInput) {
	const targetIds = await resolveHawkbitTargetIds(companyId, {
		deviceIds: data.deviceIds,
		categoryIds: data.categoryIds,
		allDevices: data.allDevices,
	});

	if (targetIds.length === 0) {
		throw new Error('No eligible devices found for deployment');
	}

	const smVersion = data.version ?? '1.0';
	const sm = await findSoftwareModule(data.artifactName, smVersion, data.artifactType);
	if (!sm) {
		throw new Error(
			`Artifact "${data.artifactName}" (${data.artifactType}) not found. ` +
			'Upload the artifact first via POST /artifacts before creating a deployment.',
		);
	}

	// Verify SM has at least one artifact (binary file)
	let smHasArtifacts = true;
	try {
		const smFiles = await hawkbitSoftwareModules.listArtifacts(sm.id);
		if (smFiles.length === 0) smHasArtifacts = false;
	} catch {
		smHasArtifacts = false;
	}
	if (!smHasArtifacts) {
		throw new Error(
			`Software Module "${sm.name}" (#${sm.id}) has no artifacts (binary files). ` +
			'Upload the artifact file first. DDI will not offer deploymentBase for an incomplete DS.',
		);
	}

	const dsType = await getOrCreateDistributionSetType(data.artifactType);
	const dsUuid = randomUUID();
	const ds = await hawkbitDistributionSets.create({
		name: `ds-${dsUuid}`,
		version: `v-${Date.now()}`,
		description: `${data.name} | artifact: ${sm.name} (${data.artifactType}) | uuid: ${dsUuid}`,
		type: dsType.typeKey,
		modules: [{ id: sm.id }],
	});

	appLogger.info(
		`[DEPLOY] Created DS #${ds.id} (type=${dsType.typeKey}) with SM #${sm.id} (${sm.name}). Assigning to ${targetIds.length} targets...`,
	);

	// Step 1: Force-close ALL pre-existing active actions.
	await forceCloseActiveActions(targetIds);

	// Step 2: Assign targets to the new DS.
	await hawkbitDistributionSets.assignTargets(ds.id, targetIds);

	// Step 3: Force-close auto-created cancel actions.
	await forceCloseCancelActions(targetIds);

	// Step 4: Verify deployment is properly offered via DDI.
	const { checkDDiReadiness } = await import('./ddi-diagnostics');
	let verifiedCount = 0;
	const failedTargets: string[] = [];

	for (const targetId of targetIds) {
		try {
			const targetActions = await hawkbitTargets.getActions(targetId, { limit: 10 });
			const activeUpdate = targetActions.content.find(
				(a: { active: boolean; type: string }) => a.active && a.type === 'update',
			);
			if (activeUpdate) {
				verifiedCount++;
			} else {
				failedTargets.push(targetId);
			}
		} catch {
			failedTargets.push(targetId);
		}
	}

	if (failedTargets.length > 0) {
		appLogger.warn('[DEPLOY] %d/%d targets FAILED verification.', failedTargets.length, targetIds.length);
		for (const targetId of failedTargets.slice(0, 3)) {
			try {
				const diag = await checkDDiReadiness(targetId);
				appLogger.error({ targetId, ...diag }, '[DEPLOY] DDI Diagnostic');
			} catch { /* diagnostic failed */ }
		}
	}

	// Write-through: register in local DB with audit data
	// Resolve artifact metadata for audit trail
	let artifactDisplayName = data.artifactName;
	let artifactOrigFile: string | null = null;
	try {
		const [localArtifact] = await db
			.select({ name: artifacts.name, originalFilename: artifacts.originalFilename })
			.from(artifacts)
			.where(eq(artifacts.hawkbitSmId, sm.id));
		if (localArtifact) {
			artifactDisplayName = localArtifact.name;
			artifactOrigFile = localArtifact.originalFilename ?? null;
		}
	} catch { /* non-critical */ }

	await db.insert(deployments).values({
		companyId,
		hawkbitDsId: ds.id,
		name: data.name,
		artifactType: data.artifactType,
		artifactName: artifactDisplayName,
		artifactVersion: sm.version,
		artifactOriginalFile: artifactOrigFile,
		targetCount: targetIds.length,
		targetIds: JSON.stringify(targetIds),
		createdBy: userId,
	});

	appLogger.info('[DEPLOY] Registered DS %d for company %s', ds.id, companyId);

	appLogger.info(
		`[DEPLOY] "${data.name}" (DS #${ds.id}): ${verifiedCount}/${targetIds.length} verified.`,
	);

	return {
		dsId: ds.id, name: data.name, version: ds.version,
		targetsAssigned: targetIds.length, artifactType: data.artifactType,
		smId: sm.id, smName: sm.name, verified: verifiedCount, failed: failedTargets.length,
	};
}

/** Get deployment — verify ownership first. */
export async function getDeployment(companyId: string, dsId: number) {
	await requireDeploymentOwnership(companyId, dsId);
	return enrichDeployment(await hawkbitDistributionSets.get(dsId));
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
export async function listDeployments(companyId: string, _params?: { offset?: number; limit?: number }) {
	// 1. Get local deployment records for this company
	let localDeployments: any[];
	try {
		localDeployments = await db
			.select()
			.from(deployments)
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

	// 3. Enrich: active DSes from hawkBit + orphaned from local DB
	const hawkbitMap = new Map(hawkbitDSs.filter((ds) => !ds.deleted).map((ds: any) => [ds.id, ds]));
	const enriched = await Promise.all(
		localDeployments.map(async (local) => {
			const hawkbitDS = hawkbitMap.get(local.hawkbitDsId);
			if (hawkbitDS) {
				return enrichDeployment(hawkbitDS);
			}
			// DS deleted/orphaned — use local audit data
			return enrichOrphanedDeployment(local);
		}),
	);
	return { data: enriched, total: enriched.length };
}

export async function getDeploymentTargets(dsId: number, params?: { offset?: number; limit?: number }) {
	return hawkbitDistributionSets.getAssignedTargets(dsId, params);
}
