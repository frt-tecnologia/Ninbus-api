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
import { getDeviceIdsByCategories, getHawkbitTargetIdsForCompany } from '@modules/devices/service';
import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';

import { enrichDeployment, summarizeStatistics, computeDeploymentStatus } from './enrichment';
export { getDeploymentTargetStatuses, getTargetStatusTrail } from './trail';
export type { TargetDeploymentStatus, TargetStatusTrail } from './trail';
import { forceCloseActiveActions, forceCloseCancelActions, forceCloseActiveActionsForDS } from './actions';

export type { EnrichedDeployment, DeploymentStatisticsSummary } from './enrichment';
export { computeDeploymentStatus, enrichDeployment, summarizeStatistics } from './enrichment';

async function resolveHawkbitTargetIds(
	companyId: string,
	options: {
		deviceIds?: string[];
		categoryIds?: string[];
		allDevices?: boolean;
	},
): Promise<string[]> {
	const targetIds = new Set<string>();

	if (options.deviceIds && options.deviceIds.length > 0) {
		const companyDevices = await db
			.select({ hawkbitTargetId: devices.hawkbitTargetId })
			.from(devices)
			.where(
				and(
					inArray(devices.id, options.deviceIds),
					eq(devices.companyId, companyId),
					eq(devices.status, 'accepted'),
				),
			);
		for (const d of companyDevices) {
			if (d.hawkbitTargetId) targetIds.add(d.hawkbitTargetId);
		}
	}

	if (options.categoryIds && options.categoryIds.length > 0) {
		const ninbusIds = await getDeviceIdsByCategories(companyId, options.categoryIds);
		if (ninbusIds.length > 0) {
			const companyDevices = await db
				.select({ hawkbitTargetId: devices.hawkbitTargetId })
				.from(devices)
				.where(
					and(
						inArray(devices.id, ninbusIds),
						eq(devices.companyId, companyId),
						eq(devices.status, 'accepted'),
					),
				);
			for (const d of companyDevices) {
				if (d.hawkbitTargetId) targetIds.add(d.hawkbitTargetId);
			}
		}
	}

	if (options.allDevices) {
		const allTargetIds = await getHawkbitTargetIdsForCompany(companyId);
		for (const id of allTargetIds) {
			targetIds.add(id);
		}
	}

	return [...targetIds];
}

async function findSoftwareModule(
	artifactNameOrSmId: string,
	version: string,
	typeKey: string,
): Promise<{ id: number; name: string; version: string } | null> {
	// If artifactName looks like a numeric SM ID, use it directly
	const asNumber = Number(artifactNameOrSmId);
	if (!isNaN(asNumber) && asNumber > 0 && String(asNumber) === artifactNameOrSmId) {
		try {
			const sm = await hawkbitSoftwareModules.get(asNumber);
			return { id: sm.id, name: sm.name, version: sm.version };
		} catch {
			return null;
		}
	}
	// Legacy fallback: search by name+version+type
	const result = await hawkbitSoftwareModules.list({
		q: `name==${artifactNameOrSmId};version==${version};type==${typeKey}`,
	});
	if (result.content.length > 0) {
		const sm = result.content[0]!;
		return { id: sm.id, name: sm.name, version: sm.version };
	}
	const byNameType = await hawkbitSoftwareModules.list({
		q: `name==${artifactNameOrSmId};type==${typeKey}`,
	});
	if (byNameType.content.length > 0) {
		const sorted = byNameType.content.sort((a, b) => b.id - a.id);
		const sm = sorted[0]!;
		return { id: sm.id, name: sm.name, version: sm.version };
	}
	return null;
}

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

	const dsType = await getOrCreateDistributionSetType(data.artifactType);

	const dsUuid = randomUUID();
	const dsName = `ds-${dsUuid}`;
	const dsVersion = `v-${Date.now()}`;

	const ds = await hawkbitDistributionSets.create({
		name: dsName,
		version: dsVersion,
		description: `${data.name} | artifact: ${sm.name} (${data.artifactType}) | uuid: ${dsUuid}`,
		type: dsType.typeKey,
		modules: [{ id: sm.id }],
	});

	// Step 1: Force-close ALL pre-existing active actions before assigning new DS.
	await forceCloseActiveActions(targetIds);

	// Step 2: Assign targets to the new DS
	await hawkbitDistributionSets.assignTargets(ds.id, targetIds);

	// Step 3: Force-close only CANCEL-type actions after assignment.
	// hawkBit auto-creates cancel actions when a new DS replaces an active one.
	// These cancel actions get stuck in "canceling" state (device doesn't send
	// cancel feedback) and BLOCK the new deploymentBase from being offered via DDI.
	// We only close cancel-type actions to preserve the new update action.
	await forceCloseCancelActions(targetIds);

	// Step 4: Verify deployment is properly offered via DDI.
	// Check that each target has exactly ONE active update action for the new DS.
	// If no active update action exists, the device will NOT see deploymentBase.
	let verifiedCount = 0;
	for (const targetId of targetIds) {
		try {
			const targetActions = await hawkbitTargets.getActions(targetId, { limit: 10 });
			const activeUpdate = targetActions.content.find(
				(a: { active: boolean; type: string }) => a.active && a.type === 'update',
			);
			if (activeUpdate) {
				verifiedCount++;
			} else {
				const activeAll = targetActions.content.filter((a: { active: boolean }) => a.active);
				appLogger.error(
					{
						targetId,
						activeActions: activeAll.map((a: { id: number; type: string; status: string }) =>
							`#${a.id}(${a.type}/${a.status})`),
					},
					'[DEPLOY] VERIFICATION FAILED: no active update action! Device will NOT see deploymentBase via DDI.',
				);
			}
		} catch (e) {
			appLogger.warn({ targetId, err: e }, '[DEPLOY] Could not verify target');
		}
	}

	appLogger.info(
		'[DEPLOY] Created deployment "%s" (DS #%d) with %d targets, artifact %s (%s). Verified: %d/%d targets have active update action.',
		data.name, ds.id, targetIds.length, sm.name, data.artifactType, verifiedCount, targetIds.length,
	);

	return {
		dsId: ds.id, name: data.name, dsName: ds.name, version: ds.version,
		targetsAssigned: targetIds.length, artifactType: data.artifactType,
		smId: sm.id, smName: sm.name,
	};
}

export async function getDeployment(dsId: number) {
	const ds = await hawkbitDistributionSets.get(dsId);
	return enrichDeployment(ds);
}

export async function getDeploymentStatistics(dsId: number) {
	const raw = await hawkbitDistributionSets.getStatistics(dsId);
	const statsMap = raw.actions || {};
	const total = raw.actions?.['total'] || 0;
	return {
		raw,
		summary: summarizeStatistics(statsMap),
		status: computeDeploymentStatus(statsMap, total),
	};
}

export async function deleteDeployment(dsId: number): Promise<void> {
	// hawkBit DS deletion does NOT cancel active actions.
	// Must cancel all active actions first, otherwise device keeps receiving deploymentBase.
	await forceCloseActiveActionsForDS(dsId);
	return hawkbitDistributionSets.delete(dsId);
}

export async function listDeployments(params?: { offset?: number; limit?: number }) {
	const result = await hawkbitDistributionSets.list(params);
	// Filter out soft-deleted DSes — these are abandoned/cleaned up deployments
	// that should not appear in the active deployment list.
	const active = result.content.filter((ds) => !ds.deleted);
	const enriched = await Promise.all(active.map((ds) => enrichDeployment(ds)));
	return { data: enriched, total: enriched.length };
}

export async function getDeploymentTargets(
	dsId: number,
	params?: { offset?: number; limit?: number },
) {
	return hawkbitDistributionSets.getAssignedTargets(dsId, params);
}
