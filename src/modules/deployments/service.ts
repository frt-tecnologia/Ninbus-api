import { db } from '@common/db';
import { devices } from '@common/db/schema';
import {
	type MenderDeployment,
	type MenderDeploymentDevice,
	type MenderDeploymentStatistics,
	type NinbusArtifactType,
	menderArtifacts,
	menderDeployments,
} from '@common/mender/client';
import { getDeviceIdsByCategories, getMenderDeviceIdsForCompany } from '@modules/devices/service';
import { DeviceSyncEngine } from '@modules/devices/sync';
import { and, eq, inArray } from 'drizzle-orm';

/**
 * Resolve target Mender device IDs from deployment parameters.
 * Supports: specific devices, categories, or all company devices.
 */
async function resolveMenderDeviceIds(
	companyId: string,
	options: {
		deviceIds?: string[];
		categoryIds?: string[];
		allDevices?: boolean;
	},
): Promise<string[]> {
	// Ensure devices are synced before resolving IDs
	await DeviceSyncEngine.syncCompany(companyId);

	const menderIds = new Set<string>();

	// Specific devices
	if (options.deviceIds && options.deviceIds.length > 0) {
		const companyDevices = await db
			.select({ menderDeviceId: devices.menderDeviceId })
			.from(devices)
			.where(
				and(
					inArray(devices.id, options.deviceIds),
					eq(devices.companyId, companyId),
					eq(devices.status, 'accepted'),
				),
			);
		for (const d of companyDevices) {
			if (d.menderDeviceId) menderIds.add(d.menderDeviceId);
		}
	}

	// Devices by categories
	if (options.categoryIds && options.categoryIds.length > 0) {
		const ninbusIds = await getDeviceIdsByCategories(companyId, options.categoryIds);
		if (ninbusIds.length > 0) {
			const companyDevices = await db
				.select({ menderDeviceId: devices.menderDeviceId })
				.from(devices)
				.where(
					and(
						inArray(devices.id, ninbusIds),
						eq(devices.companyId, companyId),
						eq(devices.status, 'accepted'),
					),
				);
			for (const d of companyDevices) {
				if (d.menderDeviceId) menderIds.add(d.menderDeviceId);
			}
		}
	}

	// All company devices
	if (options.allDevices) {
		const allMenderIds = await getMenderDeviceIdsForCompany(companyId);
		for (const id of allMenderIds) {
			menderIds.add(id);
		}
	}

	return [...menderIds];
}

export interface CreateDeploymentInput {
	name: string;
	artifactName: string;
	artifactType: NinbusArtifactType;
	deviceIds?: string[];
	categoryIds?: string[];
	allDevices?: boolean;
	retries?: number;
}

export async function createDeployment(companyId: string, data: CreateDeploymentInput) {
	const menderDeviceIds = await resolveMenderDeviceIds(companyId, {
		deviceIds: data.deviceIds,
		categoryIds: data.categoryIds,
		allDevices: data.allDevices,
	});

	if (menderDeviceIds.length === 0) {
		throw new Error('No eligible devices found for deployment');
	}

	// Validate artifact exists and matches type before creating deployment
	const artifactValidation = await validateArtifactForDeployment(
		data.artifactName,
		data.artifactType,
	);

	const deployment = await menderDeployments.create({
		name: data.name,
		artifact_name: data.artifactName,
		devices: menderDeviceIds,
		retries: data.retries,
	});

	return {
		...deployment,
		artifactType: data.artifactType,
		artifactMeta: artifactValidation,
	};
}

/**
 * Validates that the artifact exists in Mender and is compatible
 * with the requested deployment type.
 *
 * @throws Error if artifact not found or type mismatch
 */
export async function validateArtifactForDeployment(
	artifactName: string,
	expectedType: NinbusArtifactType,
) {
	// Fetch all artifacts and find by name
	const artifacts = await menderArtifacts.list({ name: artifactName });
	const artifact = artifacts.find((a) => a.name === artifactName);

	if (!artifact) {
		throw new Error(
			`Artifact '${artifactName}' not found in Mender. Upload it first via POST /api/companies/:companyId/artifacts`,
		);
	}

	// Validate device type compatibility
	if (
		artifact.device_types_compatible.length > 0 &&
		!artifact.device_types_compatible.includes('ninbus-wifi-v3')
	) {
		throw new Error(
			`Artifact '${artifactName}' is not compatible with ninbus-wifi-v3. ` +
				`Compatible types: ${artifact.device_types_compatible.join(', ')}`,
		);
	}

	return {
		artifactId: artifact.id,
		artifactName: artifact.name,
		size: artifact.size,
		expectedType,
		deviceTypesCompatible: artifact.device_types_compatible,
		validated: true,
	};
}

export async function getDeployment(deploymentId: string): Promise<MenderDeployment> {
	return menderDeployments.get(deploymentId);
}

export async function getDeploymentStatistics(
	deploymentId: string,
): Promise<MenderDeploymentStatistics> {
	return menderDeployments.getStatistics(deploymentId);
}

export async function abortDeployment(deploymentId: string): Promise<void> {
	return menderDeployments.abort(deploymentId);
}

export async function abortDeviceDeployment(deviceId: string): Promise<void> {
	return menderDeployments.abortDevice(deviceId);
}

export async function getDeploymentDevices(
	deploymentId: string,
	params?: { status?: string; page?: number; perPage?: number },
): Promise<MenderDeploymentDevice[]> {
	return menderDeployments.listDevices(deploymentId, params);
}

export async function getDeviceDeploymentLog(
	deploymentId: string,
	deviceId: string,
): Promise<string> {
	return menderDeployments.getDeviceLog(deploymentId, deviceId);
}

export async function getDeviceDeploymentHistory(
	menderDeviceId: string,
	params?: { status?: string; page?: number; perPage?: number },
) {
	return menderDeployments.listDeviceHistory(menderDeviceId, params);
}
