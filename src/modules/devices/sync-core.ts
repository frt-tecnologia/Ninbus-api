/**
 * Sync Engine — Status protection, types, and target data extraction.
 * Shared between all sync strategies.
 */
import { db } from '@common/db';
import { devices } from '@common/db/schema';
import { appLogger } from '@common/logger';
import { eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Status Protection — prevents sync engine from overwriting post-deletion state
// ---------------------------------------------------------------------------

/**
 * When a deployment is deleted, we set local devices to 'in_sync'.
 * But hawkBit's target.updateStatus may still be 'pending' for a few sync cycles
 * (hawkBit doesn't update target status instantly after DS deletion).
 * This map protects recently-cleared device statuses from being overwritten.
 *
 * Key: hawkbitTargetId (controllerId)
 * Value: { status to enforce, expiry timestamp }
 */
const statusProtection = new Map<string, { status: HawkbitUpdateStatus; until: number }>();

/** TTL for status protection (2 minutes — enough for hawkBit to catch up). */
const STATUS_PROTECTION_TTL_MS = 120_000;

/** Protect a set of targets from sync overwrites. Called after deployment deletion. */
export function protectTargetStatuses(targetIds: string[], status: HawkbitUpdateStatus, ttlMs = STATUS_PROTECTION_TTL_MS): void {
	const until = Date.now() + ttlMs;
	for (const id of targetIds) {
		statusProtection.set(id, { status, until });
	}
	appLogger.info('[SYNC] Protected %d target statuses as \'%s\' for %ds', targetIds.length, status, Math.round(ttlMs / 1000));
}

/** Check if a target's status is currently protected. Returns enforced status or null. */
export function getProtectedStatus(targetId: string): HawkbitUpdateStatus | null {
	const entry = statusProtection.get(targetId);
	if (!entry) return null;
	if (Date.now() > entry.until) {
		statusProtection.delete(targetId);
		return null;
	}
	return entry.status;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncState {
	lastFullSyncAt: Date | null;
	isRunning: boolean;
	totalSynced: number;
	lastDurationMs: number;
	errors: number;
	mode: 'periodic' | 'on_demand' | 'hybrid';
	lastIncrementalTimestamp: number | null;
}

export type ConnectionStatus = 'unknown' | 'connected' | 'disconnected';
export type HawkbitUpdateStatus = 'unknown' | 'in_sync' | 'pending' | 'registered' | 'error';

// ---------------------------------------------------------------------------
// Target data extraction
// ---------------------------------------------------------------------------

export function mapUpdateStatus(status: string | undefined): HawkbitUpdateStatus {
	if (!status) return 'unknown';
	const lower = status.toLowerCase();
	if (lower === 'in_sync') return 'in_sync';
	if (lower === 'pending') return 'pending';
	if (lower === 'registered') return 'registered';
	if (lower === 'error') return 'error';
	return 'unknown';
}

export function extractTargetData(target: {
	pollStatus?: { overdue?: boolean; lastRequestAt?: number; nextExpectedRequestAt?: number } | null;
	updateStatus?: string;
	ipAddress?: string | null;
}): {
	connectionStatus: ConnectionStatus;
	hawkbitUpdateStatus: HawkbitUpdateStatus;
	ipAddress: string | null;
	lastPollAt: Date | null;
	nextExpectedPollAt: Date | null;
	lastSeenAt: Date | null;
} {
	const isConnected = target.pollStatus ? !target.pollStatus.overdue : false;
	return {
		connectionStatus: isConnected ? 'connected' : 'disconnected',
		hawkbitUpdateStatus: mapUpdateStatus(target.updateStatus),
		ipAddress: target.ipAddress ?? null,
		lastPollAt: target.pollStatus?.lastRequestAt
			? new Date(target.pollStatus.lastRequestAt) : null,
		nextExpectedPollAt: target.pollStatus?.nextExpectedRequestAt
			? new Date(target.pollStatus.nextExpectedRequestAt) : null,
		lastSeenAt: target.pollStatus?.lastRequestAt
			? new Date(target.pollStatus.lastRequestAt) : null,
	};
}

// ---------------------------------------------------------------------------
// Single-device stale-while-revalidate sync
// ---------------------------------------------------------------------------

/** Single-device stale-while-revalidate sync. */
export async function syncSingleDeviceSwr(targetId: string, hawkbitConfig: { enabled: boolean; syncStaleSec: number }): Promise<{
	updateStatus: string; connectionStatus: string; lastSeen: string | null; ipAddress: string | null;
} | null> {
	if (!hawkbitConfig.enabled) return null;

	const { hawkbitTargets } = await import('@common/hawkbit/client');
	const staleMs = hawkbitConfig.syncStaleSec * 1000;
	const [device] = await db
		.select({ updatedAt: devices.updatedAt })
		.from(devices)
		.where(eq(devices.hawkbitTargetId, targetId));

	if (device?.updatedAt && Date.now() - device.updatedAt.getTime() < staleMs) {
		const [fresh] = await db
			.select({
				hawkbitUpdateStatus: devices.hawkbitUpdateStatus,
				connectionStatus: devices.connectionStatus,
				lastSeenAt: devices.lastSeenAt,
				ipAddress: devices.ipAddress,
			})
			.from(devices)
			.where(eq(devices.hawkbitTargetId, targetId));

		if (fresh) {
			return {
				updateStatus: fresh.hawkbitUpdateStatus ?? 'unknown',
				connectionStatus: fresh.connectionStatus ?? 'unknown',
				lastSeen: fresh.lastSeenAt?.toISOString() ?? null,
				ipAddress: fresh.ipAddress ?? null,
			};
		}
	}

	try {
		const target = await hawkbitTargets.get(targetId);
		const isConnected = target.pollStatus ? !target.pollStatus.overdue : false;

		const targetData = extractTargetData(target);
		const protectedStatus = getProtectedStatus(targetId);
		if (protectedStatus) {
			targetData.hawkbitUpdateStatus = protectedStatus;
		}

		await db
			.update(devices)
			.set({ ...targetData, updatedAt: new Date() })
			.where(eq(devices.hawkbitTargetId, targetId));

		return {
			updateStatus: target.updateStatus ?? 'unknown',
			connectionStatus: isConnected ? 'connected' : 'disconnected',
			lastSeen: target.pollStatus?.lastRequestAt
				? new Date(target.pollStatus.lastRequestAt).toISOString() : null,
			ipAddress: target.ipAddress ?? null,
		};
	} catch {
		return null;
	}
}
