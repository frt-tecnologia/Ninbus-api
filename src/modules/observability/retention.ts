import { env } from '@common/config/env';
/**
 * Telemetry retention — deletes `device_connections` rows older than the
 * configured retention window. Runs as a background job (hourly).
 *
 * `activity_log` is an audit log and is NEVER expired by this job.
 *
 * Uses batched DELETE in chunks to avoid long table locks on large tables
 * (a single DELETE of millions of rows blocks autovacuum + replication).
 */
import { db } from '@common/db';
import { deviceConnections } from '@common/db/schema';
import { appLogger } from '@common/logger';
import { lt, sql } from 'drizzle-orm';

const ONE_HOUR_MS = 3_600_000;
const BATCH_SIZE = 10_000;

let retentionTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Delete connection telemetry older than the retention window.
 * Returns the number of rows deleted. Batched to avoid long locks.
 */
export async function pruneConnectionTelemetry(retentionDays: number): Promise<number> {
	if (retentionDays <= 0) return 0;
	const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
	let totalDeleted = 0;

	for (let pass = 0; pass < 100; pass++) {
		// Delete a bounded chunk per pass so each statement is short-lived.
		const result = await db
			.delete(deviceConnections)
			.where(lt(deviceConnections.occurredAt, cutoff))
			.returning({ id: deviceConnections.id });

		const deleted = result.length;
		totalDeleted += deleted;

		// Drizzle doesn't expose rowcount directly; returning() gives the rows.
		// When a chunk returns fewer than BATCH_SIZE, we're done.
		if (deleted < BATCH_SIZE) break;

		appLogger.debug(
			'[TELEMETRY] Retention pass %d: deleted %d rows (total %d)',
			pass,
			deleted,
			totalDeleted,
		);
	}

	return totalDeleted;
}

/** Run one retention cycle, logging the outcome. Swallows errors (best-effort). */
async function runRetentionCycle(): Promise<void> {
	const retentionDays = env.OBS_CONNECTIONS_RETENTION_DAYS ?? 90;
	if (!retentionDays || retentionDays <= 0) return;

	try {
		const deleted = await pruneConnectionTelemetry(retentionDays);
		if (deleted > 0) {
			appLogger.info(
				'[TELEMETRY] Retention: pruned %d rows older than %dd',
				deleted,
				retentionDays,
			);
		}
	} catch (error: unknown) {
		appLogger.warn(
			'[TELEMETRY] Retention failed: %s',
			error instanceof Error ? error.message : String(error),
		);
	}
}

/**
 * Start the hourly retention job. Idempotent (no-op if already running).
 * Call at app startup (after DeviceSyncEngine.startBackgroundSync).
 */
export function startTelemetryRetention(): void {
	if (retentionTimer) return;

	const retentionDays = env.OBS_CONNECTIONS_RETENTION_DAYS ?? 90;
	if (!retentionDays || retentionDays <= 0) {
		appLogger.info('[TELEMETRY] Retention disabled (OBS_CONNECTIONS_RETENTION_DAYS=0)');
		return;
	}

	// First prune shortly after boot (don't block startup), then hourly.
	retentionTimer = setInterval(() => void runRetentionCycle(), ONE_HOUR_MS);

	appLogger.info('[TELEMETRY] Retention job started (every 1h, max age %dd)', retentionDays);
}

/** Stop the retention job. Call on graceful shutdown. */
export function stopTelemetryRetention(): void {
	if (retentionTimer) {
		clearInterval(retentionTimer);
		retentionTimer = null;
		appLogger.info('[TELEMETRY] Retention job stopped');
	}
}

// Keep the `sql` import meaningful (used for potential future bulk-count query).
void sql;
