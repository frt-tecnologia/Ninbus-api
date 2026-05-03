/**
 * Mender Gateway Client — API functions + Ninbus artifact type constants.
 *
 * Artifact types for Ninbus devices (ninbus-wifi-v3):
 * - firmware-ninbus       → NAND firmware → reboot (bootloader aplica)
 * - firmware-controller   → CAN → LightDot
 * - configuration-nfx     → NAND NFX → CAN → LightDot
 */
import { menderRequest } from './http';
import type {
	MenderArtifact,
	MenderConnectionState,
	MenderDeployment,
	MenderDeploymentDevice,
	MenderDeploymentStatistics,
	MenderDevice,
	MenderDeviceDeployment,
	MenderInventoryDevice,
	MenderRelease,
} from './types';

// Re-export types for convenience
export type {
	MenderArtifact,
	MenderConnectionState,
	MenderDeployment,
	MenderDeploymentDevice,
	MenderDeploymentStatistics,
	MenderDevice,
	MenderDeviceDeployment,
	MenderInventoryDevice,
	MenderRelease,
};
export { MenderApiError } from './http';

// ---------------------------------------------------------------------------
// Ninbus Artifact Types
// ---------------------------------------------------------------------------

export const NINBUS_ARTIFACT_TYPES = {
	NINBUS_FIRMWARE: 'firmware-ninbus',
	CONTROLLER_FIRMWARE: 'firmware-controller',
	NFX_CONFIGURATION: 'configuration-nfx',
} as const;

export type NinbusArtifactType = (typeof NINBUS_ARTIFACT_TYPES)[keyof typeof NINBUS_ARTIFACT_TYPES];

export const NINBUS_ARTIFACT_TYPE_META: Record<
	NinbusArtifactType,
	{
		label: string;
		description: string;
		target: string;
		requiresReboot: boolean;
		riskLevel: 'low' | 'medium' | 'high';
	}
> = {
	[NINBUS_ARTIFACT_TYPES.NINBUS_FIRMWARE]: {
		label: 'Firmware Ninbus',
		description: 'Firmware principal do STM32F407 (Ninbus WiFi v3)',
		target: 'NAND Flash → Bootloader → Flash interna',
		requiresReboot: true,
		riskLevel: 'high',
	},
	[NINBUS_ARTIFACT_TYPES.CONTROLLER_FIRMWARE]: {
		label: 'Firmware Controlador',
		description: 'Firmware do controlador LightDot via barramento CAN',
		target: 'CAN Bus → LightDot',
		requiresReboot: false,
		riskLevel: 'medium',
	},
	[NINBUS_ARTIFACT_TYPES.NFX_CONFIGURATION]: {
		label: 'Configuração NFX',
		description: 'Configuração NFX/FRZ dos painéis via CAN',
		target: 'NAND NFX → CAN → LightDot',
		requiresReboot: false,
		riskLevel: 'low',
	},
};

export const NINBUS_DEVICE_TYPE = 'ninbus-wifi-v3';

export function isNinbusArtifactType(type: string): type is NinbusArtifactType {
	return Object.values(NINBUS_ARTIFACT_TYPES).includes(type as NinbusArtifactType);
}

/**
 * Resolve the Ninbus artifact type from a Mender artifact.
 *
 * The type is stored in `updates[0].type_info.type` inside the .mender file header.
 * This is set by `mender-artifact write module-image -T <type>` at build time.
 *
 * Fallback chain:
 * 1. `updates[0].type_info.type` (primary — the actual Mender API field)
 * 2. `artifact_provides['type']` (v3 artifact provides)
 */
export function resolveArtifactType(artifact: {
	updates?: Array<{ type_info: { type: string | null } }>;
	artifact_provides?: Record<string, string>;
}): NinbusArtifactType | null {
	// Primary: updates[0].type_info.type — the canonical field
	const updateType = artifact.updates?.[0]?.type_info?.type;
	if (updateType && isNinbusArtifactType(updateType)) return updateType;

	// Fallback: artifact_provides['type'] for v3 artifacts
	const providesType = artifact.artifact_provides?.['type'];
	if (providesType && isNinbusArtifactType(providesType)) return providesType;

	return null;
}

// ---------------------------------------------------------------------------
// Device Auth API
// ---------------------------------------------------------------------------

export const menderDeviceAuth = {
	listDevices(params?: { status?: string; page?: number; perPage?: number }): Promise<
		MenderDevice[]
	> {
		return menderRequest({
			method: 'GET',
			path: '/api/management/v2/devauth/devices',
			query: { status: params?.status, page: params?.page, per_page: params?.perPage },
		});
	},
	getDevice(deviceId: string): Promise<MenderDevice> {
		return menderRequest({ method: 'GET', path: `/api/management/v2/devauth/devices/${deviceId}` });
	},
	setAuthStatus(deviceId: string, authId: string, status: 'accepted' | 'rejected'): Promise<void> {
		return menderRequest({
			method: 'PUT',
			path: `/api/management/v2/devauth/devices/${deviceId}/auth/${authId}/status`,
			body: { status },
		});
	},
	decommission(deviceId: string): Promise<void> {
		return menderRequest({
			method: 'DELETE',
			path: `/api/management/v2/devauth/devices/${deviceId}`,
		});
	},
	count(status?: string): Promise<{ count: number }> {
		return menderRequest({
			method: 'GET',
			path: '/api/management/v2/devauth/devices/count',
			query: { status },
		});
	},
	preauthorize(data: {
		identity_data: Record<string, string>;
		pubkey: string;
	}): Promise<MenderDevice> {
		return menderRequest({
			method: 'POST',
			path: '/api/management/v2/devauth/devices',
			body: data,
		});
	},
};

// ---------------------------------------------------------------------------
// Inventory API
// ---------------------------------------------------------------------------

export const menderInventory = {
	listDevices(params?: { page?: number; perPage?: number; group?: string; sort?: string }): Promise<
		MenderInventoryDevice[]
	> {
		return menderRequest({
			method: 'GET',
			path: '/api/management/v1/inventory/devices',
			query: {
				page: params?.page,
				per_page: params?.perPage,
				group: params?.group,
				sort: params?.sort,
			},
		});
	},
	getDevice(deviceId: string): Promise<MenderInventoryDevice> {
		return menderRequest({
			method: 'GET',
			path: `/api/management/v1/inventory/devices/${deviceId}`,
		});
	},
	listGroups(): Promise<string[]> {
		return menderRequest({ method: 'GET', path: '/api/management/v1/inventory/groups' });
	},
	setDeviceGroup(deviceId: string, group: string): Promise<void> {
		return menderRequest({
			method: 'PUT',
			path: `/api/management/v1/inventory/devices/${deviceId}/group`,
			body: { group },
		});
	},
};

// ---------------------------------------------------------------------------
// Deployments API — Artifacts
// ---------------------------------------------------------------------------

export const menderArtifacts = {
	list(params?: { page?: number; perPage?: number; name?: string }): Promise<MenderArtifact[]> {
		return menderRequest({
			method: 'GET',
			path: '/api/management/v1/deployments/artifacts',
			query: { page: params?.page, per_page: params?.perPage, name: params?.name },
		});
	},
	get(artifactId: string): Promise<MenderArtifact> {
		return menderRequest({
			method: 'GET',
			path: `/api/management/v1/deployments/artifacts/${artifactId}`,
		});
	},
	upload(formData: FormData): Promise<void> {
		return menderRequest({
			method: 'POST',
			path: '/api/management/v1/deployments/artifacts',
			body: formData,
		});
	},
	delete(artifactId: string): Promise<void> {
		return menderRequest({
			method: 'DELETE',
			path: `/api/management/v1/deployments/artifacts/${artifactId}`,
		});
	},
	update(artifactId: string, data: { description: string }): Promise<void> {
		return menderRequest({
			method: 'PUT',
			path: `/api/management/v1/deployments/artifacts/${artifactId}`,
			body: data,
		});
	},
	getDownloadLink(artifactId: string): Promise<{ uri: string; expire: string }> {
		return menderRequest({
			method: 'GET',
			path: `/api/management/v1/deployments/artifacts/${artifactId}/download`,
		});
	},
};

// ---------------------------------------------------------------------------
// Deployments API — Management
// ---------------------------------------------------------------------------

export const menderDeployments = {
	create(data: {
		name: string;
		artifact_name: string;
		devices: string[];
		retries?: number;
		phases?: Array<{ batch_size: number; start_ts?: string }>;
	}): Promise<{ id: string }> {
		return menderRequest({
			method: 'POST',
			path: '/api/management/v1/deployments/deployments',
			body: data,
		});
	},
	get(deploymentId: string): Promise<MenderDeployment> {
		return menderRequest({
			method: 'GET',
			path: `/api/management/v1/deployments/deployments/${deploymentId}`,
		});
	},
	getStatistics(deploymentId: string): Promise<MenderDeploymentStatistics> {
		return menderRequest({
			method: 'GET',
			path: `/api/management/v1/deployments/deployments/${deploymentId}/statistics`,
		});
	},
	abort(deploymentId: string): Promise<void> {
		return menderRequest({
			method: 'PUT',
			path: `/api/management/v1/deployments/deployments/${deploymentId}/status`,
			body: { status: 'aborted' },
		});
	},
	abortDevice(deviceId: string): Promise<void> {
		return menderRequest({
			method: 'DELETE',
			path: `/api/management/v1/deployments/deployments/devices/${deviceId}`,
		});
	},
	listDevices(
		deploymentId: string,
		params?: { status?: string; page?: number; perPage?: number },
	): Promise<MenderDeploymentDevice[]> {
		return menderRequest({
			method: 'GET',
			path: `/api/management/v1/deployments/deployments/${deploymentId}/devices/list`,
			query: { status: params?.status, page: params?.page, per_page: params?.perPage },
		});
	},
	getDeviceLog(deploymentId: string, deviceId: string): Promise<string> {
		return menderRequest({
			method: 'GET',
			path: `/api/management/v1/deployments/deployments/${deploymentId}/devices/${deviceId}/log`,
		});
	},
	listDeviceHistory(
		deviceId: string,
		params?: { status?: string; page?: number; perPage?: number },
	): Promise<MenderDeviceDeployment[]> {
		return menderRequest({
			method: 'GET',
			path: `/api/management/v1/deployments/deployments/devices/${deviceId}`,
			query: { status: params?.status, page: params?.page, per_page: params?.perPage },
		});
	},
};

// ---------------------------------------------------------------------------
// Releases & Device Connect
// ---------------------------------------------------------------------------

export const menderReleases = {
	list(params?: { page?: number; perPage?: number; name?: string }): Promise<MenderRelease[]> {
		return menderRequest({
			method: 'GET',
			path: '/api/management/v2/deployments/deployments/releases',
			query: { page: params?.page, per_page: params?.perPage, name: params?.name },
		});
	},
	setTags(name: string, tags: string[]): Promise<void> {
		return menderRequest({
			method: 'PUT',
			path: `/api/management/v2/deployments/deployments/releases/${encodeURIComponent(name)}/tags`,
			body: tags,
		});
	},
};

export const menderDeviceConnect = {
	getConnectionState(deviceId: string): Promise<MenderConnectionState> {
		return menderRequest({
			method: 'GET',
			path: `/api/management/v1/deviceconnect/devices/${deviceId}`,
		});
	},
	forceCheckUpdate(deviceId: string): Promise<void> {
		return menderRequest({
			method: 'POST',
			path: `/api/management/v1/deviceconnect/devices/${deviceId}/check-update`,
		});
	},
};
