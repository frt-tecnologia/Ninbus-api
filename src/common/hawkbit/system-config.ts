/**
 * hawkBit System Configuration — runtime, DB-backed tenant configs.
 *
 * `pollingTime` is a hawkBit RUNTIME system config (stored in the system_config
 * table, NOT a Spring property). It is writable only via the Management API:
 *
 *   PUT /rest/v1/system/configs/pollingTime
 *   Content-Type: application/json
 *   body: {"value":"HH:MM:SS"}        ← JSON object, NOT a raw string
 *
 * The API pushes the value declared in the Ninbus .env (HAWKBIT_POLLING_TIME,
 * single source of truth) into hawkBit at startup, so production — which has
 * no direct Management API access — can control device polling purely from .env.
 *
 * MINIMUM FLOOR: hawkBit rejects pollingTime below `hawkbit.controller.min-
 * polling-time` (Spring property, default 00:00:30). That floor lives on the
 * HAWKBIT CONTAINER (HAWKBIT_MIN_POLLING_TIME in docker-compose), NOT here —
 * the API cannot change it at runtime. For sub-30s polling, lower the floor in
 * docker-compose AND restart hawkBit.
 *
 * Best-effort + retried: hawkBit takes up to 180s to boot, so this retries
 * until the PUT succeeds. Non-fatal — if it never succeeds, hawkBit keeps its
 * DB-persisted value (or the built-in default 00:05:00).
 */
import { hawkbitConfig } from '@common/config/hawkbit';
import { db } from '@common/db';
import { platformSettings } from '@common/db/schema';
import { appLogger } from '@common/logger';
import { eq } from 'drizzle-orm';
import { HawkbitApiError, hawkbitRequest } from './http';

// ---------------------------------------------------------------------------

const DURATION_PATTERN = /^\d{2}:\d{2}:\d{2}$/;

export const POLLING_SETTINGS_KEY = 'hawkbit_polling_time';
export const POLLING_SEC_MIN = 5;
export const POLLING_SEC_MAX = 86_400;

const EFFECTIVE_CACHE_TTL_MS = 30_000;

let effectiveCache: { sec: number; source: 'override' | 'env-default'; expiresAt: number } | null =
	null;

export function secondsToPollingTime(totalSec: number): string {
	const hours = Math.floor(totalSec / 3600);
	const minutes = Math.floor((totalSec % 3600) / 60);
	const seconds = totalSec % 60;
	return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

export function pollingTimeToSeconds(hhmmss: string): number {
	const [hours = 0, minutes = 0, seconds = 0] = hhmmss.split(':').map(Number);
	return hours * 3600 + minutes * 60 + seconds;
}

export function isValidPollingSec(sec: unknown): sec is number {
	return (
		typeof sec === 'number' &&
		Number.isInteger(sec) &&
		sec >= POLLING_SEC_MIN &&
		sec <= POLLING_SEC_MAX
	);
}

interface StoredPollingOverride {
	sec: number;
	updatedBy: string | null;
	updatedAt: Date;
}

async function readStoredOverride(): Promise<StoredPollingOverride | null> {
	const [row] = await db
		.select({
			value: platformSettings.value,
			updatedBy: platformSettings.updatedBy,
			updatedAt: platformSettings.updatedAt,
		})
		.from(platformSettings)
		.where(eq(platformSettings.key, POLLING_SETTINGS_KEY));
	if (!row) return null;
	const sec = Number(row.value);
	if (!isValidPollingSec(sec)) return null;
	return { sec, updatedBy: row.updatedBy, updatedAt: row.updatedAt };
}

export interface PollingTimeState {
	effectiveSec: number;
	source: 'override' | 'env-default';
	updatedBy: string | null;
	updatedAt: Date | null;
}

export async function getPollingTimeState(): Promise<PollingTimeState> {
	if (effectiveCache && effectiveCache.expiresAt > Date.now()) {
		return {
			effectiveSec: effectiveCache.sec,
			source: effectiveCache.source,
			updatedBy: null,
			updatedAt: null,
		};
	}
	const override = await readStoredOverride().catch(() => null);
	const state: PollingTimeState = override
		? {
				effectiveSec: override.sec,
				source: 'override',
				updatedBy: override.updatedBy,
				updatedAt: override.updatedAt,
			}
		: {
				effectiveSec: pollingTimeToSeconds(hawkbitConfig.pollingTime),
				source: 'env-default',
				updatedBy: null,
				updatedAt: null,
			};
	effectiveCache = {
		sec: state.effectiveSec,
		source: state.source,
		expiresAt: Date.now() + EFFECTIVE_CACHE_TTL_MS,
	};
	return state;
}

export function clearPollingTimeCache(): void {
	effectiveCache = null;
}

export async function getEffectivePollingSec(): Promise<number> {
	return (await getPollingTimeState()).effectiveSec;
}

export async function setPollingTimeSec(sec: number, updatedBy: string): Promise<PollingTimeState> {
	if (!hawkbitConfig.enabled) {
		throw new Error('hawkBit integration is disabled (HAWKBIT_ENABLED=false)');
	}
	if (!isValidPollingSec(sec)) {
		throw new Error(
			`pollingSec must be an integer between ${POLLING_SEC_MIN} and ${POLLING_SEC_MAX}`,
		);
	}

	await applyPollingTimeConfig(secondsToPollingTime(sec));

	await db
		.insert(platformSettings)
		.values({ key: POLLING_SETTINGS_KEY, value: String(sec), updatedBy })
		.onConflictDoUpdate({
			target: platformSettings.key,
			set: { value: String(sec), updatedBy, updatedAt: new Date() },
		});
	clearPollingTimeCache();

	appLogger.info(
		'[HAWKBIT-CONFIG] pollingTime override saved: %ds (by %s), pushed to hawkBit',
		sec,
		updatedBy,
	);
	return getPollingTimeState();
}

/**
 * Push the .env-declared polling time into hawkBit (single attempt).
 * Throws on network/HTTP error so the retried wrapper can back off.
 */
export async function applyPollingTimeConfig(pollingTimeToApply?: string): Promise<void> {
	if (!hawkbitConfig.enabled) {
		appLogger.debug('[HAWKBIT-CONFIG] hawkBit disabled — skipping polling-time apply');
		return;
	}

	const pollingTime = pollingTimeToApply ?? secondsToPollingTime(await getEffectivePollingSec());
	if (!DURATION_PATTERN.test(pollingTime)) {
		appLogger.error(
			'[HAWKBIT-CONFIG] Invalid HAWKBIT_POLLING_TIME="%s" (expected HH:MM:SS)',
			pollingTime,
		);
		return;
	}

	await hawkbitRequest<void>({
		method: 'PUT',
		path: '/rest/v1/system/configs/pollingTime',
		// hawkBit 1.0.3 requires application/json with a {"value":...} object.
		// A raw string or text/plain body is rejected (415 / "not well formed").
		body: { value: pollingTime },
		headers: { 'Content-Type': 'application/json' },
	});
	appLogger.info('[HAWKBIT-CONFIG] Set pollingTime=%s in hawkBit', pollingTime);
}

const MAX_ATTEMPTS = 20;
const RETRY_INTERVAL_MS = 15_000;

/**
 * Apply polling-time config with retry/backoff until success.
 * Fire-and-forget at startup — survives hawkBit's slow boot (~180s).
 * Idempotent: safe to call on every restart (re-establishes the .env value).
 *
 * Validation errors (HTTP 400 — e.g. pollingTime below the min-polling-time
 * floor) are NOT retried: they cannot be fixed by retrying, so we bail out
 * with an actionable message instead of looping for 5 minutes.
 */
export async function applyPollingTimeConfigRetried(): Promise<void> {
	if (!hawkbitConfig.enabled) return;

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			await applyPollingTimeConfig();
			return; // success
		} catch (err: any) {
			// 400 = validation error (e.g. pollingTime below the floor). Retrying
			// won't help — bail out with an actionable message.
			if (err instanceof HawkbitApiError && err.status === 400) {
				appLogger.error(
					`[HAWKBIT-CONFIG] hawkBit rejected the pollingTime config (HTTP 400): ${err?.message ?? err}. ` +
						'If below 30s, lower the hawkBit container floor HAWKBIT_MIN_POLLING_TIME ' +
						'(Spring hawkbit.controller.min-polling-time) in docker-compose and restart hawkBit.',
				);
				return;
			}
			appLogger.warn(
				'[HAWKBIT-CONFIG] Attempt %d/%d failed: %s. Retrying in %ds...',
				attempt,
				MAX_ATTEMPTS,
				err?.message ?? err,
				RETRY_INTERVAL_MS / 1000,
			);
			await new Promise((r) => setTimeout(r, RETRY_INTERVAL_MS));
		}
	}
	appLogger.error(
		'[HAWKBIT-CONFIG] Gave up after %d attempts. hawkBit keeps its current/default polling time.',
		MAX_ATTEMPTS,
	);
}
