import { db } from '@common/db';
import { devices } from '@common/db/schema';
import {
	type HawkbitDistributionSet,
	type NinbusArtifactType,
	getOrCreateSoftwareModuleType,
	hawkbitDistributionSets,
	hawkbitSoftwareModules,
} from '@common/hawkbit/client';
import { getDeviceIdsByCategories, getHawkbitTargetIdsForCompany } from '@modules/devices/service';
import { DeviceSyncEngine } from '@modules/devices/sync';
import { and, eq, inArray } from 'drizzle-orm';

/**
 * Resolve target hawkBit target IDs from deployment parameters.
 * Supports: specific devices, categories, or all company devices.
 */
async function resolveHawkbitTargetIds(
	companyId: string,
	options: {
		deviceIds?: string[];
		categoryIds?: string[];
		allDevices?: boolean;
	},
): Promise<string[]> {
	await DeviceSyncEngine.syncCompany(companyId);

	const targetIds = new Set<string>();

	// Specific devices
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

	// Devices by categories
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

	// All company devices
	if (options.allDevices) {
		const allTargetIds = await getHawkbitTargetIdsForCompany(companyId);
		for (const id of allTargetIds) {
			targetIds.add(id);
		}
	}

	return [...targetIds];
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

	// 1. Get or create the Software Module Type for this artifact type
	const smType = await getOrCreateSoftwareModuleType(data.artifactType);

	// 2. Create a Software Module (artifact container)
	const sm = await hawkbitSoftwareModules.create({
		name: data.artifactName,
		version: data.version ?? '1.0',
		type: smType.typeKey,
		description: `Ninbus OTA: ${data.artifactType} — ${data.name}`,
	});

	// 3. Create a Distribution Set with the Software Module
	const ds = await hawkbitDistributionSets.create({
		name: data.name,
		version: data.version ?? '1.0',
		description: `Deployment: ${data.name} (${data.artifactType})`,
		modules: [{ id: sm.id }],
	});

	// 4. Assign targets to the Distribution Set
	await hawkbitDistributionSets.assignTargets(ds.id, targetIds);

	return {
		dsId: ds.id,
		name: ds.name,
		version: ds.version,
		targetsAssigned: targetIds.length,
		artifactType: data.artifactType,
	};
}

export async function getDeployment(dsId: number): Promise<HawkbitDistributionSet> {
	return hawkbitDistributionSets.get(dsId);
}

export async function getDeploymentStatistics(dsId: number): Promise<unknown> {
	return hawkbitDistributionSets.getStatistics(dsId);
}

export async function deleteDeployment(dsId: number): Promise<void> {
	return hawkbitDistributionSets.delete(dsId);
}

export async function listDeployments(params?: {
	offset?: number;
	limit?: number;
}): Promise<{ data: HawkbitDistributionSet[]; total: number }> {
	const result = await hawkbitDistributionSets.list(params);
	return { data: result.content, total: result.total };
}

export async function getDeploymentTargets(
	dsId: number,
	params?: { offset?: number; limit?: number },
) {
	return hawkbitDistributionSets.getAssignedTargets(dsId, params);
}
