/**
 * Device connection telemetry service — TRANSITION EVENTS ONLY.
 *
 * Core principle (cost/volume optimization): a row is inserted ONLY when a
 * device's connection state CHANGES (online↔offline), never on every hawkBit
 * poll. Steady-state devices produce ZERO writes per sync cycle. This keeps
 * storage + write-CPU minimal at scale while preserving full observability.
 *
 * Sessions (graph bands) are COMPUTED at read time from event pairs via a LEAD
 * window function — never stored as rows. An "online" event with no subsequent
 * "offline" is closed at NOW() (no zombie sessions).
 */
import { db } from '@common/db';
import { deviceConnections } from '@common/db/schema';
import { appLogger } from '@common/logger';
import { statusCoalescer } from '@common/sse';
import { and, count, eq, gte, lte, sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Status classification
// ---------------------------------------------------------------------------

const ONLINE_STATES = new Set(['online', 'connected']);

/** Classify a raw connectionStatus string into online (true) / offline (false). */
function isOnline(status: string | null | undefined): boolean {
	return !!status && ONLINE_STATES.has(status);
}

// ---------------------------------------------------------------------------
// Write (called from sync, only on a real transition)
// ---------------------------------------------------------------------------

export interface ConnectionTransitionInput {
	deviceId: string;
	companyId: string;
	hawkbitTargetId: string | null;
	deviceName: string;
	/** Previous connection status (from DB row before update). */
	previous: string | null;
	/** New connection status (from hawkBit). */
	current: string | null;
	/** Timestamp the event occurred (hawkBit poll time / now). */
	occurredAt: Date;
	ipAddress?: string | null;
}

/**
 * Record a connection transition. Determined online↔offline from the NEW status.
 * Best-effort: telemetry capture must never break the sync cycle.
 */
export async function recordConnectionTransition(input: ConnectionTransitionInput): Promise<void> {
	const onlineNow = isOnline(input.current);
	const onlineBefore = isOnline(input.previous);

	// Defensive: only insert on a real transition (caller already filters, but
	// guard against duplicates / no-op calls).
	if (onlineNow === onlineBefore) return;

	try {
		await db.insert(deviceConnections).values({
			deviceId: input.deviceId,
			companyId: input.companyId,
			hawkbitTargetId: input.hawkbitTargetId,
			deviceName: input.deviceName,
			event: onlineNow ? 'online' : 'offline',
			occurredAt: input.occurredAt,
			ipAddress: input.ipAddress ?? null,
		});

		// SSE: push the transition to connected clients via the coalescer. This
		// is the single chokepoint ALL transitions funnel through (sync normal +
		// staleness sweep), so emitting here guarantees no transition is silently
		// dropped from the real-time feed.
		statusCoalescer.record(input.companyId, {
			id: input.deviceId,
			s: input.current ?? 'unknown',
			t: input.occurredAt.toISOString(),
		});
	} catch (error: any) {
		appLogger.debug(
			'[TELEMETRY] Failed to record transition for device %s: %s',
			input.deviceId,
			error?.message ?? 'unknown',
		);
	}
}

// ---------------------------------------------------------------------------
// Read — sessions (graph bands) computed from event pairs
// ---------------------------------------------------------------------------

export interface SessionBand {
	deviceId: string;
	hawkbitTargetId: string | null;
	deviceName: string | null;
	start: Date;
	end: Date;
	ipAddress: string | null;
}

export interface ListSessionsOptions {
	companyId?: string;
	deviceId?: string;
	from: Date;
	to: Date;
}

/**
 * Compute online sessions (bands) from transition events within [from, to].
 * Each "online" event starts a band; the band ends at the next event for the
 * same device, or NOW() if still open. Uses a LEAD window function.
 */
export async function listSessions(opts: ListSessionsOptions): Promise<SessionBand[]> {
	const conditions = [
		gte(deviceConnections.occurredAt, opts.from),
		lte(deviceConnections.occurredAt, opts.to),
	];
	if (opts.companyId) conditions.push(eq(deviceConnections.companyId, opts.companyId));
	if (opts.deviceId) conditions.push(eq(deviceConnections.deviceId, opts.deviceId));

	// LEAD finds the next event timestamp per device; COALESCE closes open bands at NOW().
	const rows = await db.execute(sql`
		SELECT
			device_id AS "deviceId",
			hawkbit_target_id AS "hawkbitTargetId",
			device_name AS "deviceName",
			occurred_at AS "start",
			COALESCE(LEAD(occurred_at) OVER (PARTITION BY device_id ORDER BY occurred_at), NOW()) AS "end",
			ip_address AS "ipAddress"
		FROM device_connections
		WHERE ${and(...conditions)} AND event = 'online'
		ORDER BY occurred_at ASC
	`);

	// `db.execute()` with postgres-js returns the rows array directly (it is NOT
	// wrapped in a `.rows` property). Cast through unknown: column aliases are
	// produced by the SQL above, not known to the static type.
	return rows as unknown as SessionBand[];
}

// ---------------------------------------------------------------------------
// Read — aggregate (long ranges: bucket temporal counts)
// ---------------------------------------------------------------------------

export interface AggregateBucket {
	bucket: Date;
	onlineCount: number;
}

/**
 * Bucketed online-event counts for long time ranges (avoids flooding the client).
 * `bucketSeconds` controls resolution (e.g. 3600 = hourly). Returns one row per
 * bucket with the count of 'online' transitions that started in that bucket.
 */
export async function aggregateOnlineEvents(opts: {
	companyId?: string;
	from: Date;
	to: Date;
	bucketSeconds?: number;
}): Promise<AggregateBucket[]> {
	const bucketSeconds = opts.bucketSeconds ?? 3600;
	const conditions = [
		gte(deviceConnections.occurredAt, opts.from),
		lte(deviceConnections.occurredAt, opts.to),
	];
	if (opts.companyId) conditions.push(eq(deviceConnections.companyId, opts.companyId));

	const rows = await db.execute(sql`
		SELECT
			to_timestamp(floor((extract('epoch' from occurred_at) / ${bucketSeconds})) * ${bucketSeconds}) AT TIME ZONE 'UTC' AS bucket,
			COUNT(*)::int AS "onlineCount"
		FROM device_connections
		WHERE ${and(...conditions)} AND event = 'online'
		GROUP BY bucket
		ORDER BY bucket ASC
	`);

	return rows as unknown as AggregateBucket[];
}

// ---------------------------------------------------------------------------
// Read — raw transition events (company-scoped timeline for device reports)
// ---------------------------------------------------------------------------

export interface ConnectionEvent {
	deviceId: string;
	deviceName: string | null;
	hawkbitTargetId: string | null;
	event: 'online' | 'offline';
	occurredAt: Date;
	ipAddress: string | null;
}

export interface ListConnectionEventsOptions {
	companyId: string;
	deviceId?: string;
	from: Date;
	to: Date;
}

/**
 * Raw connection transition events for a company within [from, to], ordered
 * oldest-first. The UI computes the timeline diff (online↔offline bands) from
 * these events — the server does NOT pre-compute sessions here. Tenant-isolated
 * by companyId (filtered at the DB).
 */
export async function listConnectionEvents(
	opts: ListConnectionEventsOptions,
): Promise<ConnectionEvent[]> {
	const conditions = [
		eq(deviceConnections.companyId, opts.companyId),
		gte(deviceConnections.occurredAt, opts.from),
		lte(deviceConnections.occurredAt, opts.to),
	];
	if (opts.deviceId) conditions.push(eq(deviceConnections.deviceId, opts.deviceId));

	return await db
		.select({
			deviceId: deviceConnections.deviceId,
			deviceName: deviceConnections.deviceName,
			hawkbitTargetId: deviceConnections.hawkbitTargetId,
			event: deviceConnections.event,
			occurredAt: deviceConnections.occurredAt,
			ipAddress: deviceConnections.ipAddress,
		})
		.from(deviceConnections)
		.where(and(...conditions))
		.orderBy(deviceConnections.occurredAt);
}

// ---------------------------------------------------------------------------
// Count helpers
// ---------------------------------------------------------------------------

/** Total connection events in range (for response metadata). */
export async function countEventsInRange(
	companyId: string | undefined,
	from: Date,
	to: Date,
): Promise<number> {
	const conditions = [
		gte(deviceConnections.occurredAt, from),
		lte(deviceConnections.occurredAt, to),
	];
	if (companyId) conditions.push(eq(deviceConnections.companyId, companyId));
	const rows = await db
		.select({ c: count() })
		.from(deviceConnections)
		.where(and(...conditions));
	return Number(rows[0]?.c ?? 0);
}
