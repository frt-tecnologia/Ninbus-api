/**
 * Deployment error classes.
 *
 * Lives in a neutral module so BOTH `service.ts` and `delete.ts` can import it
 * without creating a circular dependency (service imports from delete, so
 * delete cannot import from service).
 *
 * CRITICAL: ownership checks (`requireDeploymentOwnership`) MUST throw this
 * typed error — NOT a plain `Error`. Route handlers test
 * `instanceof DeploymentNotFoundError` to return a correct 404. A plain Error
 * is not recognized and falls through to the catch-all → misleading 503
 * "Service Unavailable" instead of an honest 404 "not found".
 */
import { HawkbitApiError } from '@common/hawkbit/http';

export class DeploymentNotFoundError extends Error {
	constructor(message = 'Deployment not found') {
		super(message);
		this.name = 'DeploymentNotFoundError';
	}
}

/** HTTP status text for a status code (for ErrorResponse bodies). */
function statusText(status: number): string {
	switch (status) {
		case 404:
			return 'Not Found';
		case 502:
			return 'Bad Gateway';
		default:
			return 'Service Unavailable';
	}
}

/**
 * Map a deployment-route error to an HTTP response shape `{ status, error, message }`.
 *
 * Replaces the old catch-all that returned 503 for EVERYTHING. That masked a
 * clear 404 ("Deployment #N not found in this company", thrown by
 * `requireDeploymentOwnership`) as a misleading "hawkBit is currently
 * unavailable" — making a local-DB ownership miss look like a hawkBit outage.
 *
 * Classification:
 *  - DeploymentNotFoundError         → 404 (not registered for this company)
 *  - HawkbitApiError .status === 404 → 404 (DS orphaned / gone in hawkBit)
 *  - HawkbitApiError .status === 401 → 502 (hawkBit auth misconfigured)
 *  - HawkbitApiError .status 408/503 → 503 (hawkBit down / unreachable / timeout)
 *  - HawkbitApiError other           → 502 (surfaced with the real status)
 *  - anything else                   → 503 (safe fallback, message preserved)
 */
export function classifyDeploymentError(error: unknown): {
	status: number;
	error: string;
	message: string;
} {
	if (error instanceof DeploymentNotFoundError) {
		return { status: 404, error: 'Not Found', message: error.message };
	}
	if (error instanceof HawkbitApiError) {
		if (error.status === 404) {
			return { status: 404, error: 'Not Found', message: 'Deployment not found in hawkBit' };
		}
		if (error.status === 401) {
			return { status: 502, error: 'Bad Gateway', message: 'hawkBit authentication failed' };
		}
		if (error.status === 408 || error.status === 503) {
			return {
				status: 503,
				error: 'Service Unavailable',
				message: 'hawkBit is currently unavailable',
			};
		}
		return { status: 502, error: 'Bad Gateway', message: `hawkBit error (${error.status})` };
	}
	const msg = error instanceof Error ? error.message : String(error);
	return { status: 503, error: statusText(503), message: msg || 'Deployment service unavailable' };
}
