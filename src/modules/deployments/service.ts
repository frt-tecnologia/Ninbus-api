import { db } from '@common/db';
import { devices } from '@common/db/schema';
import {
	type NinbusArtifactType,
	getOrCreateDistributionSetType,
	hawkbitDistributionSets,
	hawkbitSoftwareModules,
	hawkbitTargets,
} from '@common/hawkbit/client';
import { appLogger } from '@common/logger';
import { randomUUID } from 'crypto';
import { inArray } from 'drizzle-orm';

import { enrichDeployment, summarizeStatistics, computeDeploymentStatus } from './enrichment';
export { getDeploymentTargetStatuses, getTargetStatusTrail } from './trail';
export type { TargetDeploymentStatus, TargetStatusTrail } from './trail';
import { forceCloseActiveActions, forceCloseCancelActions, forceCloseActiveActionsForDS } from './actions';
export { checkDDiReadiness, type DdiDiagnosticResult } from './ddi-diagnostics';
import { resolveHawkbitTargetIds, findSoftwareModule } from './helpers';

export type { EnrichedDeployment, DeploymentStatisticsSummary } from './enrichment';
export { computeDeploymentStatus, enrichDeployment, summarizeStatistics } from './enrichment';

export interface CreateDeploymentInput {
	name: string;
	artifactName: string;
	artifactType: NinbusArtifactType;
	version?: string;
	deviceIds?: string[];
	categoryIds?: string[];
	allDevices?: boolean;
}

export async function createDeployment(companyId: string, data: CreateDeploymentInput) {
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
		const artifacts = await hawkbitSoftwareModules.listArtifacts(sm.id);
		if (artifacts.length === 0) smHasArtifacts = false;
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

	appLogger.info(
		`[DEPLOY] "${data.name}" (DS #${ds.id}): ${verifiedCount}/${targetIds.length} verified.`,
	);

	return {
		dsId: ds.id, name: data.name, version: ds.version,
		targetsAssigned: targetIds.length, artifactType: data.artifactType,
		smId: sm.id, smName: sm.name, verified: verifiedCount, failed: failedTargets.length,
	};
}

export async function getDeployment(dsId: number) {
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
 * Delete a deployment — properly stops it so it doesn't come back.
 *
 * Steps:
 * 1. Get all targets assigned to this DS
 * 2. Force-close ALL their active actions (update + cancel)
 * 3. Delete the DS from hawkBit (soft-delete)
 * 4. Clear local device status for affected targets (pending → in_sync)
 * 5. Emit SSE events so frontend updates immediately
 */
export async function deleteDeployment(dsId: number, companyId?: string): Promise<void> {
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

	// Step 4: Clear local device status for affected targets
	// After deleting the DS, devices that were "pending" should go back to "in_sync"
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
			// hawkBit may still report 'pending' for a few cycles after DS deletion
			const { protectTargetStatuses } = await import('@modules/devices/sync-helpers');
			protectTargetStatuses(targetControllerIds, 'in_sync');
		} catch (e) {
			appLogger.warn('[DEPLOY] Could not clear local device status: %s', e);
		}
	}

	// Step 5: Emit SSE events so frontend updates immediately
	if (companyId && targetControllerIds.length > 0) {
		try {
			const { sseEmitter } = await import('@common/sse');
			// Notify that deployment was deleted
			sseEmitter.emit(companyId, 'deployment.deleted', {
				deploymentId: dsId,
				timestamp: new Date().toISOString(),
			});
			// Notify each device status changed
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

export async function listDeployments(params?: { offset?: number; limit?: number }) {
	const result = await hawkbitDistributionSets.list(params);
	// Filter out soft-deleted DSes
	const active = result.content.filter((ds) => !ds.deleted);
	const enriched = await Promise.all(active.map((ds) => enrichDeployment(ds)));
	return { data: enriched, total: enriched.length };
}

export async function getDeploymentTargets(dsId: number, params?: { offset?: number; limit?: number }) {
	return hawkbitDistributionSets.getAssignedTargets(dsId, params);
}
