import { http } from './http';

/**
 * Observability service — super-admin endpoints for the company observability page.
 *
 * All routes are platform-level (`/api/admin/*`), superAdmin-gated. They feed the
 * three sections of the company observability view: activity feed, device
 * connection timeline, and aggregated categories.
 */

// ── Types (mirror the API response schemas) ─────────────────────────────

export interface ActivityLogEntry {
	id: number;
	actorUserId: string | null;
	actorEmail: string | null;
	companyId: string | null;
	action: string;
	entityType: string;
	entityId: string;
	entityLabel: string | null;
	metadata: Record<string, unknown>;
	ipAddress: string | null;
	createdAt: string;
}

export interface ActivityListResponse {
	data: ActivityLogEntry[];
	total: number;
	hasMore: boolean;
}

export interface SessionBand {
	deviceId: string;
	hawkbitTargetId: string | null;
	deviceName: string | null;
	start: string;
	end: string;
	ipAddress: string | null;
}

export interface AggregateBucket {
	bucket: string;
	onlineCount: number;
}

export interface ConnectionsResponse {
	view: 'session' | 'aggregate';
	range: { from: string; to: string };
	data: SessionBand[] | AggregateBucket[];
	total: number;
}

export interface AggregatedCategory {
	id: string;
	companyId: string;
	companyName: string | null;
	name: string;
	type: string;
	description: string | null;
	deviceCount: number;
	createdAt: string;
}

export interface AggregatedCategoryListResponse {
	data: AggregatedCategory[];
	total: number;
}

// ── Platform stats (overview) ──────────────────────────────────────────

export interface DailyOnlinePoint {
	date: string;
	online: number;
}

export interface CompanyActivity {
	companyId: string;
	companyName: string | null;
	actions: number;
}

export interface HourlyBucket {
	hour: number;
	count: number;
}

export interface PlatformStats {
	range: { from: string; to: string };
	onlineHistogram: DailyOnlinePoint[];
	deploymentCreated: number;
	deploymentDeleted: number;
	artifactUploaded: number;
	topCompanies: CompanyActivity[];
	updateHourDistribution: HourlyBucket[];
	newUserDesignations: number;
	onlineDevices: number;
}

// ── Query helpers ───────────────────────────────────────────────────────

const iso = (d: Date) => d.toISOString();

export const observabilityService = {
	/** Audit activity feed (cursor-paginated, filterable). */
	async activity(opts?: {
		companyId?: string;
		entityType?: string;
		action?: string;
		actorUserId?: string;
		from?: Date;
		to?: Date;
		limit?: number;
		before?: number;
	}): Promise<ActivityListResponse> {
		return http.get<ActivityListResponse>('/admin/activity', {
			companyId: opts?.companyId,
			entityType: opts?.entityType,
			action: opts?.action,
			actorUserId: opts?.actorUserId,
			from: opts?.from ? iso(opts.from) : undefined,
			to: opts?.to ? iso(opts.to) : undefined,
			limit: opts?.limit,
			before: opts?.before,
		});
	},

	/** Device connection timeline (session bands or aggregate buckets). */
	async connections(opts: {
		from: Date;
		to: Date;
		companyId?: string;
		deviceId?: string;
		view?: 'session' | 'aggregate' | 'auto';
	}): Promise<ConnectionsResponse> {
		return http.get<ConnectionsResponse>('/admin/devices/connections', {
			from: iso(opts.from),
			to: iso(opts.to),
			companyId: opts.companyId,
			deviceId: opts.deviceId,
			view: opts.view,
		});
	},

	/** Cross-company categories with live device counts. */
	async categories(opts?: {
		companyId?: string;
		type?: string;
	}): Promise<AggregatedCategoryListResponse> {
		return http.get<AggregatedCategoryListResponse>('/admin/categories', {
			companyId: opts?.companyId,
			type: opts?.type,
		});
	},

	/** Platform overview stats (rich overview page). */
	async stats(opts?: { from?: Date; to?: Date }): Promise<PlatformStats> {
		return http.get<PlatformStats>('/admin/stats', {
			from: opts?.from ? iso(opts.from) : undefined,
			to: opts?.to ? iso(opts.to) : undefined,
		});
	},
};
