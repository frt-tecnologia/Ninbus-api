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
import { type SQL, and, desc, eq, gte, lt, lte } from 'drizzle-orm';

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
