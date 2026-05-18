/**
 * hawkBit Management API Types.
 * DTOs matching the hawkBit server REST API responses.
 *
 * Key concept mapping from Mender:
 * - Mender Device   → hawkBit Target (controllerId)
 * - Mender Artifact → hawkBit Software Module + Artifact (binary file)
 * - Mender Deployment → hawkBit Distribution Set + Assignment to targets
 * - Mender Inventory → hawkBit Target Attributes
 * - Mender Connection State → hawkBit Target pollStatus
 *
 * @see https://www.eclipse.org/hawkbit/apis/management/
 */

// ---------------------------------------------------------------------------
// Target (Device)
// ---------------------------------------------------------------------------

export interface HawkbitTarget {
	controllerId: string;
	name: string;
	description?: string;
	updateStatus?: string;
	createdAt?: number;
	lastModifiedAt?: number;
	lastControllerRequestAt?: number;
	installedAt?: number;
	ipAddress?: string;
	address?: string;
	pollStatus?: HawkbitPollStatus;
	securityToken?: string;
	requestAttributes?: boolean;
	targetType?: number;
	targetTypeName?: string;
	autoConfirmActive?: boolean;
	group?: string;
	_links?: Record<string, { href: string }>;
}

export interface HawkbitPollStatus {
	lastRequestAt: number;
	nextExpectedRequestAt: number;
	overdue: boolean;
}

export interface HawkbitTargetRequestBody {
	controllerId: string;
	name: string;
	description?: string;
	address?: string;
	securityToken?: string;
	requestAttributes?: boolean;
	targetType?: number;
	group?: string;
}

export interface HawkbitTargetAttributes {
	[key: string]: string;
}

// ---------------------------------------------------------------------------
// Software Module (Artifact container)
// ---------------------------------------------------------------------------

export interface HawkbitSoftwareModule {
	id: number;
	name: string;
	version: string;
	type: string;
	typeName: string;
	description?: string;
	vendor?: string;
	encrypted?: boolean;
	locked?: boolean;
	deleted?: boolean;
	complete?: boolean;
	createdBy?: string;
	createdAt?: number;
	lastModifiedBy?: string;
	lastModifiedAt?: number;
	_links?: Record<string, { href: string }>;
}

export interface HawkbitSoftwareModuleRequestBody {
	name: string;
	version: string;
	type: string;
	description?: string;
	vendor?: string;
	encrypted?: boolean;
}

export interface HawkbitSoftwareModuleType {
	id: number;
	key: string;
	name: string;
	description?: string;
	colour?: string;
	deleted?: boolean;
	minArtifacts?: number;
	maxAssignments?: number;
}

// ---------------------------------------------------------------------------
// Artifact (binary file within a Software Module)
// ---------------------------------------------------------------------------

export interface HawkbitArtifact {
	id: number;
	providedFilename?: string;
	size?: number;
	hashes?: { sha1?: string; sha256?: string; md5?: string };
	createdBy?: string;
	createdAt?: number;
	lastModifiedBy?: string;
	lastModifiedAt?: number;
	_links?: Record<string, { href: string }>;
}

// ---------------------------------------------------------------------------
// Distribution Set (Deployment unit)
// ---------------------------------------------------------------------------

export interface HawkbitDistributionSet {
	id: number;
	name: string;
	version?: string;
	type?: string;
	typeName?: string;
	description?: string;
	locked?: boolean;
	deleted?: boolean;
	valid?: boolean;
	requiredMigrationStep?: boolean;
	complete?: boolean;
	modules?: HawkbitSoftwareModule[];
	createdBy?: string;
	createdAt?: number;
	lastModifiedBy?: string;
	lastModifiedAt?: number;
	_links?: Record<string, { href: string }>;
}

export interface HawkbitDistributionSetType {
	id: number;
	key: string;
	name: string;
	description?: string;
	colour?: string;
	deleted?: boolean;
}

// ---------------------------------------------------------------------------
// Action (deployment status per target)
// ---------------------------------------------------------------------------

export interface HawkbitAction {
	id: number;
	type: string;
	active: boolean;
	status: string;
	forceType?: 'soft' | 'forced' | 'timeforced' | 'downloadonly';
	forceTime?: number;
	weight?: number;
	rollout?: number;
	rolloutName?: string;
	lastStatusCode?: number;
	externalRef?: string;
	createdBy?: string;
	createdAt?: number;
	lastModifiedBy?: string;
	lastModifiedAt?: number;
	_links?: Record<string, { href: string; name?: string }>;
}

export interface HawkbitActionStatus {
	id: number;
	type:
		| 'finished'
		| 'error'
		| 'warning'
		| 'running'
		| 'canceled'
		| 'canceling'
		| 'retrieved'
		| 'download'
		| 'scheduled'
		| 'cancel_rejected'
		| 'downloaded'
		| 'wait_for_confirmation';
	messages?: string[];
	reportedAt?: number;
	timestamp?: number;
	code?: number;
}

// ---------------------------------------------------------------------------
// Distribution Set Statistics (Deployment Progress)
// ---------------------------------------------------------------------------

/**
 * hawkBit DS statistics response — maps action status type (UPPERCASE)
 * to count of targets in that status.
 *
 * Example (live):
 *   { "actions": { "RETRIEVED": 1, "total": 1 }, "rollouts": { "total": 0 }, "totalAutoAssignments": 0 }
 *
 * Action status values observed in hawkBit 1.0.3:
 *   RUNNING, RETRIEVED, DOWNLOAD, DOWNLOADED, FINISHED,
 *   ERROR, WARNING, CANCELED, CANCELING, SCHEDULED,
 *   WAIT_FOR_CONFIRMATION
 */
export interface HawkbitDSStatistics {
	actions: {
		total: number;
		[statusType: string]: number;
	};
	rollouts: {
		total: number;
	};
	totalAutoAssignments: number;
}

// ---------------------------------------------------------------------------
// Paginated Response & Misc
// ---------------------------------------------------------------------------

export interface HawkbitPagedResponse<T> {
	content: T[];
	total: number;
	size?: number;
}
