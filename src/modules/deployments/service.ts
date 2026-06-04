import { db } from '@common/db';
import { deployments, devices } from '@common/db/schema';
import {
	type NinbusArtifactType,
	getOrCreateDistributionSetType,
	hawkbitDistributionSets,
	hawkbitSoftwareModules,
	hawkbitTargets,
} from '@common/hawkbit/client';
import { appLogger } from '@common/logger';
import { randomUUID } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';

import { enrichDeployment, summarizeStatistics, computeDeploymentStatus } from './enrichment';
export { getDeploymentTargetStatuses, getTargetStatusTrail } from './trail';
export type { TargetDeploymentStatus, TargetStatusTrail } from './trail';
import { forceCloseActiveActions, forceCloseCancelActions, forceCloseActiveActionsForDS } from './actions';
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
// Ownership check (same pattern as artifacts)
// ---------------------------------------------------------------------------

async function requireOwnership(companyId: string, hawkbitDsId: number): Promise<void> {
	const [local] = await db
		.select({ companyId: deployments.companyId })
		.from(deployments)
		.where(eq(deployments.hawkbitDsId, hawkbitDsId));

	if (!local || local.companyId !== companyId) {
		throw new DeploymentNotFoundError(`Deployment #${hawkbitDsId} not found in this company`);
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

	// Write-through: register in local DB
	await db.insert(deployments).values({
		companyId,
		hawkbitDsId: ds.id,
		name: data.name,
		artifactType: data.artifactType,
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
	await requireOwnership(companyId, dsId);
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

/**
 * Delete a deployment — verify ownership, then stop + delete + clean up.
 */
export async function deleteDeployment(dsId: number, companyId: string): Promise<void> {
	await requireOwnership(companyId, dsId);

	appLogger.info('[DEPLOY] Deleting deployment DS #%d...', dsId);

	// Step 1: Collect target IDs before force-closing
	let targetControllerIds: string[] = [];
	try {
		const targets = await hawkbitDistributionSets.getAssignedTargets(dsId, { limit: 500 });
		targetControllerIds = targets.content.map((t) => t.controllerId);
		appLogger.info('[DEPLOY] DS #%d has %d assigned targets', dsId, targetControllerIds.length);
	} catch (e) {
		appLogger.warn('[DEPLOY] Could not list targets for DS #%d: %s', dsId, e);
	}

	// Step 2: Force-close ALL active actions for every target in this DS
	if (targetControllerIds.length > 0) {
		await forceCloseActiveActionsForDS(dsId);
	}

	// Step 3: Delete the DS from hawkBit
	await hawkbitDistributionSets.delete(dsId);
	appLogger.info('[DEPLOY] DS #%d deleted from hawkBit', dsId);

	// Step 4: Delete local record
	await db.delete(deployments).where(eq(deployments.hawkbitDsId, dsId));

	// Step 5: Clear local device status for affected targets
	if (targetControllerIds.length > 0) {
		try {
			await db
				.update(devices)
				.set({
					hawkbitUpdateStatus: 'in_sync',
					updatedAt: new Date(),
				})
				.where(
					inArray(devices.hawkbitTargetId, targetControllerIds),
				);
			appLogger.info(
				`[DEPLOY] Cleared pending status for ${targetControllerIds.length} local devices`,
			);

			// Protect these targets from sync engine overwriting status back to 'pending'
			const { protectTargetStatuses } = await import('@modules/devices/sync-helpers');
			protectTargetStatuses(targetControllerIds, 'in_sync');
		} catch (e) {
			appLogger.warn('[DEPLOY] Could not clear local device status: %s', e);
		}
	}

	// Step 6: Emit SSE events so frontend updates immediately
	if (targetControllerIds.length > 0) {
		try {
			const { sseEmitter } = await import('@common/sse');
			sseEmitter.emit(companyId, 'deployment.deleted', {
				deploymentId: dsId,
				timestamp: new Date().toISOString(),
			});
			const localDevices = await db
				.select({ id: devices.id, hawkbitTargetId: devices.hawkbitTargetId })
				.from(devices)
				.where(inArray(devices.hawkbitTargetId, targetControllerIds));
			for (const d of localDevices) {
				sseEmitter.emit(companyId, 'device.status', {
					deviceId: d.id,
					connectionStatus: 'disconnected',
					hawkbitUpdateStatus: 'in_sync',
					lastPollAt: null,
					ipAddress: null,
				});
			}
		} catch { /* SSE failure is non-critical */ }
	}

	appLogger.info('[DEPLOY] Deployment DS #%d fully deleted and cleaned up', dsId);
}

/** List deployments for a specific company (like getCompanyDevices). */
export async function listDeployments(companyId: string, _params?: { offset?: number; limit?: number }) {
	// 1. Get local deployment records for this company
	let localDeployments: any[];
	try {
		localDeployments = await db
			.select()
			.from(deployments)
			.where(eq(deployments.companyId, companyId));
	} catch (dbError: any) {
		appLogger.error({ err: dbError }, '[DEPLOYMENTS] DB query failed for company %s: %s', companyId, dbError?.message ?? 'unknown');
		return { data: [], total: 0 };
	}

	if (localDeployments.length === 0) {
		return { data: [], total: 0 };
	}

	// 2. Fetch DS data from hawkBit by IDs (company-scoped)
	const dsIds = localDeployments.map((d: any) => d.hawkbitDsId);
	try {
		const hawkbitDSs = await hawkbitDistributionSets.listByIds(dsIds);
		// Filter out soft-deleted DSes
		const active = hawkbitDSs.filter((ds) => !ds.deleted);
		const enriched = await Promise.all(active.map((ds) => enrichDeployment(ds)));
		return { data: enriched, total: enriched.length };
	} catch (hbError: any) {
		appLogger.warn({ err: hbError }, '[DEPLOYMENTS] hawkBit unavailable for company %s: %s', companyId, hbError?.message ?? 'unknown');
		return { data: [], total: 0 };
	}
}

export async function getDeploymentTargets(dsId: number, params?: { offset?: number; limit?: number }) {
	return hawkbitDistributionSets.getAssignedTargets(dsId, params);
}
