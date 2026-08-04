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
import { appLogger } from '@common/logger';
import { HawkbitApiError, hawkbitRequest } from './http';

// ---------------------------------------------------------------------------

const DURATION_PATTERN = /^\d{2}:\d{2}:\d{2}$/;

/**
 * Push the .env-declared polling time into hawkBit (single attempt).
 * Throws on network/HTTP error so the retried wrapper can back off.
 */
export async function applyPollingTimeConfig(): Promise<void> {
	if (!hawkbitConfig.enabled) {
		appLogger.debug('[HAWKBIT-CONFIG] hawkBit disabled — skipping polling-time apply');
		return;
	}

	const pollingTime = hawkbitConfig.pollingTime;
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
					`[HAWKBIT-CONFIG] hawkBit rejected pollingTime=${hawkbitConfig.pollingTime} (HTTP 400): ${err?.message ?? err}. ` +
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
