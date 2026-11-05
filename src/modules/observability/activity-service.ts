/**
 * Activity log service — append-only audit feed (super-admin observability).
 *
 * `logActivity()` is the single helper injected at every mutation point across
 * the API. It is BEST-EFFORT: a logging failure MUST NEVER break the primary
 * mutation. Volume is inherently low (human actions), so a direct `await` INSERT
 * is appropriate — no queue, no premature optimization.
 */
import { db } from '@common/db';
import { activityLog } from '@common/db/schema';
import type { ActivityAction, ActivityEntity } from '@common/db/schema/observability';
import { appLogger } from '@common/logger';
import { and, desc, eq, gte, lt, lte, type SQL, sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LogActivityInput {
	actorUserId: string | null;
	actorEmail: string | null;
	companyId: string | null;
	action: ActivityAction;
	entityType: ActivityEntity;
	entityId: string;
	/** Human-readable snapshot of the entity. Accepts null (entity may be gone). */
	entityLabel?: string | null;
	metadata?: Record<string, unknown>;
	ipAddress?: string;
}

export interface ActivityLogRow {
	id: number;
	actorUserId: string | null;
	actorEmail: string | null;
	companyId: string | null;
	action: ActivityAction;
	entityType: ActivityEntity;
	entityId: string;
	entityLabel: string | null;
	metadata: Record<string, unknown> | null;
	ipAddress: string | null;
	createdAt: Date;
}

export interface ListActivityFilters {
	companyId?: string;
	entityType?: ActivityEntity;
	action?: ActivityAction;
	actorUserId?: string;
	from?: Date;
	to?: Date;
	limit?: number;
	/** Cursor: return rows with id < before (pagination backwards in time). */
	before?: number;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Append one audit entry. Best-effort: swallows errors so the caller's mutation
 * is never affected. Actor email + entity label are snapshotted (survive later
 * deletions) because this is an immutable audit log.
 */
export async function logActivity(input: LogActivityInput): Promise<void> {
	try {
		await db.insert(activityLog).values({
			actorUserId: input.actorUserId,
			actorEmail: input.actorEmail,
			companyId: input.companyId,
			action: input.action,
			entityType: input.entityType,
			entityId: input.entityId,
			entityLabel: input.entityLabel ?? null,
			metadata: input.metadata ?? {},
			ipAddress: input.ipAddress ?? null,
		});
	} catch (error: any) {
		// Non-fatal: audit logging must never break the primary operation.
		appLogger.warn(
			'[AUDIT] Failed to log activity %s: %s',
			input.action,
			error?.message ?? 'unknown',
		);
	}
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

const MAX_PAGE = 200;

/**
 * List audit entries with optional filters and backwards cursor pagination.
 * Ordered newest-first. Returns rows + a `hasMore` flag.
 */
export async function listActivity(
	filters: ListActivityFilters,
): Promise<{ rows: ActivityLogRow[]; hasMore: boolean }> {
	const limit = Math.min(Math.max(filters.limit ?? 50, 1), MAX_PAGE);
	const conditions: SQL[] = [];

	if (filters.companyId) conditions.push(eq(activityLog.companyId, filters.companyId));
	if (filters.entityType) conditions.push(eq(activityLog.entityType, filters.entityType));
	if (filters.action) conditions.push(eq(activityLog.action, filters.action));
	if (filters.actorUserId) conditions.push(eq(activityLog.actorUserId, filters.actorUserId));
	if (filters.from) conditions.push(gte(activityLog.createdAt, filters.from));
	if (filters.to) conditions.push(lte(activityLog.createdAt, filters.to));
	if (filters.before) conditions.push(lt(activityLog.id, filters.before));

	const rows = await db
		.select({
			id: activityLog.id,
			actorUserId: activityLog.actorUserId,
			actorEmail: activityLog.actorEmail,
			companyId: activityLog.companyId,
			action: activityLog.action,
			entityType: activityLog.entityType,
			entityId: activityLog.entityId,
			entityLabel: activityLog.entityLabel,
			metadata: activityLog.metadata,
			ipAddress: activityLog.ipAddress,
			createdAt: activityLog.createdAt,
		})
		.from(activityLog)
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.orderBy(desc(activityLog.id))
		.limit(limit + 1);

	const hasMore = rows.length > limit;
	const page = hasMore ? rows.slice(0, limit) : rows;
	return { rows: page as ActivityLogRow[], hasMore };
}

// ---------------------------------------------------------------------------
// Heat map — per-day counts computed server-side (GROUP BY)
// ---------------------------------------------------------------------------

export interface ActivityHeatBucket {
	bucket: string;
	count: number;
}

const DAY_MS = 86_400_000;

/**
 * Activity volume per calendar day (Sao Paulo) for the heat map. The client
 * used to rebuild this from a raw 200-event sample — wrong at any scale and a
 * heavy response. One GROUP BY here answers a whole year for any volume.
 */
export async function heatActivity(opts: { from: Date; to: Date }): Promise<ActivityHeatBucket[]> {
	const rows = await db.execute(sql`
		SELECT to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS bucket,
			COUNT(*)::int AS count
		FROM activity_log
		WHERE created_at >= ${opts.from} AND created_at <= ${opts.to}
		GROUP BY bucket
		ORDER BY bucket ASC
	`);
	return rows as unknown as ActivityHeatBucket[];
}

/** Zero-filled day series in [from, to] — ready for the heat map component. */
export function fillActivityHeat(
	buckets: readonly ActivityHeatBucket[],
	from: Date,
	to: Date,
): { date: string; count: number }[] {
	const byDay = new Map(buckets.map((b) => [b.bucket, b.count]));
	const first = new Date(
		`${new Date(from.getTime() - DAY_MS).toISOString().slice(0, 10)}T12:00:00Z`,
	);
	const days: { date: string; count: number }[] = [];
	for (let cursor = first; cursor <= to; cursor = new Date(cursor.getTime() + DAY_MS)) {
		const date = cursor.toISOString().slice(0, 10);
		days.push({ date, count: byDay.get(date) ?? 0 });
	}
	return days;
}
