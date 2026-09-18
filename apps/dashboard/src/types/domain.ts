/**
 * Domain types — mirror the Ninbus API response schemas.
 *
 * Source of truth: the API's TypeBox schemas (src/modules/admin/schemas.ts,
 * companies/schemas.ts, devices/schemas.ts, deployments/schemas.ts).
 * These TypeScript interfaces are the dashboard's view of the API contracts.
 *
 * Update here when the API schema changes. Keeping them in sync prevents
 * silent breakage (the dashboard fails typecheck if the shape drifts).
 */

// ── Company ────────────────────────────────────────────────────────────

export interface Company {
	id: string;
	name: string;
	status: 'active' | 'suspended';
	hawkbitTenantId: string | null;
	createdAt: string;
	updatedAt: string;
	memberCount: number;
	deviceCount: number;
	pendingCount: number;
}

export interface CompanyDetail extends Company {}

export interface CreateCompanyInput {
	name: string;
	ownerEmail: string;
}

export interface CompanyStatusUpdate {
	status: 'active' | 'suspended';
}

// ── User ───────────────────────────────────────────────────────────────

export interface User {
	id: string;
	name: string;
	email: string;
	emailVerified: boolean;
	image: string | null;
	createdAt: string;
	updatedAt: string;
	companyCount: number;
	isSuperAdmin: boolean;
}

// ── Device ─────────────────────────────────────────────────────────────

export type DeviceStatus = 'pending' | 'accepted' | 'rejected' | 'disabled';
export type ConnectionStatus = 'online' | 'offline' | 'unknown' | string;

export interface Device {
	id: string;
	companyId: string | null;
	hawkbitTargetId: string | null;
	name: string;
	serialNumber: string | null;
	serialDisplay: string | null;
	status: DeviceStatus | string;
	connectionStatus: ConnectionStatus | null;
	createdAt: string;
	updatedAt: string;
	lastSeenAt: string | null;
	/** hawkBit poll telemetry — drives the connectivity section. */
	lastPollAt?: string | null;
	nextExpectedPollAt?: string | null;
	ipAddress?: string | null;
	hawkbitUpdateStatus?: string | null;
	/** Firmware version the device reported via DDI (null = never reported). */
	firmwareVersion?: string | null;
	/** Controller (LightDot peripheral) firmware version reported via DDI. */
	controllerFirmwareVersion?: string | null;
	/** Admin enrichment: latest factory firmware version at query time. */
	latestFirmwareVersion?: string | null;
	/** Admin enrichment: up_to_date | update_available | unknown | error | no_release */
	firmwareStatus?: string;
}

export interface ProvisionDeviceInput {
	serialNumber: string;
	deviceKey: string;
	name?: string;
}

export interface DeviceCategory {
	id: string;
	companyId: string;
	name: string;
	type: string;
	description: string | null;
	createdAt: string;
	updatedAt: string;
}

// ── Designation (pending company member) ───────────────────────────────

export interface PendingDesignation {
	id: string;
	companyId: string;
	companyName: string;
	email: string;
	role: string;
	claimedAt: string | null;
	createdAt: string;
}

// ── Deployment ─────────────────────────────────────────────────────────

export type DeploymentStatus =
	| 'pending'
	| 'in_progress'
	| 'completed'
	| 'failed'
	| 'canceled'
	| 'no_targets'
	| 'unknown';

export interface EnrichedDeployment {
	id: number;
	name: string;
	displayName?: string;
	version?: string;
	type?: string;
	typeName?: string;
	description?: string;
	createdAt?: number;
	lastModifiedAt?: number;
	status: DeploymentStatus;
	statistics: {
		totalTargets: number;
		finished: number;
		failed: number;
		inProgress: number;
		pending: number;
		canceled: number;
	};
	dsMetadata: {
		locked: boolean;
		complete: boolean;
		valid: boolean;
	};
	artifactName?: string;
	artifactVersion?: string;
	artifactOriginalFile?: string;
	targetCount?: number;
	targetIds?: string[];
	/** Client-side tag: the owning company for cross-company ("all") views.
	 *  Not returned by the API — set by the dashboard when aggregating. */
	companyId?: string;
}

// ── Target status (per-device deployment outcome) ────────────────────

export interface TargetActionStatus {
	id: number;
	type: string;
	active: boolean;
	status: string;
	phase: DeploymentPhase | string;
	progress: number | null;
	message: string;
}

/** Per-target deployment status (controllerId + its action phase/progress). */
export interface TargetDeploymentStatus {
	controllerId: string;
	name: string;
	updateStatus: string;
	action: TargetActionStatus | null;
}

// ── Status trail (observability timeline per device) ───────────────────

export type DeploymentPhase =
	| 'assigned'
	| 'pending'
	| 'downloading'
	| 'downloaded'
	| 'installing'
	| 'installed'
	| 'error'
	| 'canceled'
	| 'unknown';

export interface StatusTrailEntry {
	phase: DeploymentPhase | string;
	reportedAt?: string | number;
	displayMessage?: string;
	progress?: number | null;
}

export interface TargetStatusTrail {
	controllerId?: string;
	name?: string;
	actionId?: number;
	phase: DeploymentPhase | string;
	progress?: number | null;
	currentMessage?: string;
	trail: StatusTrailEntry[];
}

// ── Firmware (factory catalog) ───────────────────────────────────────

export type FirmwareArtifactType = 'firmware-ninbus' | 'firmware-controller';

/** A factory-published firmware release (global catalog). */
export interface FirmwareRelease {
	id: string;
	name: string;
	/** Semantic version tag (required at upload, unique per type). */
	version: string;
	artifactType: FirmwareArtifactType | string;
	/** Release gate: draft (factory testing) | published (available to users). */
	status: 'draft' | 'published';
	description: string | null;
	originalFilename: string | null;
	payloadSize: number | null;
	packageSize: number | null;
	createdBy: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface FirmwareUploadInput {
	file: File;
	name: string;
	version: string;
	artifactType: FirmwareArtifactType;
	description?: string;
}

// ── API envelope shapes ────────────────────────────────────────────────

export interface ListResponse<T> {
	data: T[];
	total: number;
}

export interface DetailResponse<T> {
	data: T;
}

export interface ActionResponse {
	message: string;
	error?: string;
}

// ── Errors ─────────────────────────────────────────────────────────────

export interface ApiError {
	error: string;
	message: string;
	status: number;
}
