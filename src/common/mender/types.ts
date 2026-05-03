/**
 * Mender Gateway API Types.
 * DTOs matching Mender Server API responses.
 */

export interface MenderDevice {
	id: string;
	identity_data?: Record<string, string>;
	status: 'pending' | 'accepted' | 'rejected' | 'preauthorized' | 'noauth';
	created_ts: string;
	updated_ts?: string;
	auth_sets?: Array<{
		id: string;
		pubkey: string;
		status: string;
		identity_data?: Record<string, string>;
	}>;
}

export interface MenderInventoryDevice {
	id: string;
	attributes?: Array<{ name: string; scope: string; value: string; description?: string }>;
	updated_ts?: string;
	group?: string;
}

/**
 * Mender Artifact — matches the actual Mender Server API response.
 *
 * The artifact type (firmware-ninbus, firmware-controller, configuration-nfx)
 * is stored inside `updates[0].type_info.type`, NOT in a top-level `type` field.
 * This is the field the embedded device reads to determine what action to take.
 *
 * @see mender-server/backend/services/deployments/model/update.go
 * @see mender-server/backend/services/deployments/model/image.go
 */
export interface MenderArtifact {
	id: string;
	name: string;
	description?: string;
	device_types_compatible: string[];
	size: number;
	modified: string;
	info?: {
		format: string;
		version: number;
	};
	signed?: boolean;
	updates?: MenderArtifactUpdate[];
	artifact_provides?: Record<string, string>;
	artifact_depends?: Record<string, string[]>;
	clears_artifact_provides?: string[];
}

/** Update entry inside a Mender artifact. */
export interface MenderArtifactUpdate {
	type_info: {
		/** Artifact type — e.g. 'firmware-ninbus', 'firmware-controller', 'configuration-nfx' */
		type: string | null;
	};
	files?: Array<{
		name: string;
		checksum: string;
		size: number;
		date?: string;
	}>;
	meta_data?: Record<string, unknown>;
}

export interface MenderDeployment {
	id: string;
	name: string;
	artifact_name: string;
	/** "software" | "configuration" */
	type?: string;
	status: 'inprogress' | 'finished' | 'aborted' | 'pending';
	device_count?: number;
	max_devices?: number;
	created: string;
	finished?: string;
	/** Array of artifact IDs targeted by this deployment */
	artifacts?: string[];
	statistics?: {
		status: MenderDeploymentStatistics;
		total_size: number;
	};
	filter?: {
		id: string;
		name?: string;
		use_group?: boolean;
		group?: string;
		terms?: Array<{ scope: string; attribute: string; type: string; value: string | string[] }>;
	} | null;
}

/**
 * Mender deployment statistics — flat map of status → count.
 * Matches Mender server: Stats map[string]int (model/device_deployment.go).
 * All 13 possible device deployment statuses are present in the response.
 */
export interface MenderDeploymentStatistics {
	success: number;
	pending: number;
	failure: number;
	downloading: number;
	installing: number;
	rebooting: number;
	noartifact: number;
	'already-installed': number;
	aborted: number;
	decommissioned: number;
	pause_before_installing: number;
	pause_before_committing: number;
	pause_before_rebooting: number;
}

/**
 * Device status within a deployment.
 * Returned by GET /deployments/:id/devices/list and GET /deployments/:id/devices.
 */
export interface MenderDeploymentDevice {
	id: string;
	status: string;
	created?: string;
	finished?: string;
	image?: MenderArtifact;
	/** Whether a deployment log is available */
	log?: boolean;
	substate?: string;
}

/**
 * Device deployment history entry.
 * Returned by GET /deployments/devices/:deviceId (ListDeviceDeployments).
 * The Mender server returns {id, deployment: {...MenderDeployment}, device: {...MenderDeploymentDevice}}.
 */
export interface MenderDeviceDeployment {
	id: string;
	deployment: MenderDeployment;
	device: MenderDeploymentDevice;
}

export interface MenderConnectionState {
	device_id: string;
	status: 'connected' | 'disconnected' | 'unknown';
	updated_ts?: string;
	created_ts?: string;
}

export interface MenderRelease {
	name: string;
	artifacts?: Array<{
		id: string;
		name: string;
		device_types_compatible: string[];
		size: number;
	}>;
	tags?: string[];
	modified: string;
}
