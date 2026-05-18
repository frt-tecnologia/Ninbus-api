import { hawkbitConfig } from '@common/config/hawkbit';
import { appLogger } from '@common/logger';

/**
 * hawkBit Management API HTTP Client — Core infrastructure.
 *
 * Centralized client for all hawkBit API calls.
 * Uses HTTP Basic Auth (username:password).
 *
 * @see https://www.eclipse.org/hawkbit/apis/management/
 */

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class HawkbitApiError extends Error {
	constructor(
		public readonly status: number,
		public readonly body: unknown,
		public readonly endpoint: string,
	) {
		super(`hawkBit API error ${status} on ${endpoint}: ${JSON.stringify(body)}`);
		this.name = 'HawkbitApiError';
	}
}

// ---------------------------------------------------------------------------
// HTTP infrastructure
// ---------------------------------------------------------------------------

interface HawkbitRequestOptions {
	method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
	path: string;
	body?: unknown;
	query?: Record<string, string | number | boolean | undefined>;
	headers?: Record<string, string>;
	timeout?: number;
}

function buildQueryString(params?: Record<string, string | number | boolean | undefined>): string {
	if (!params) return '';
	const parts = Object.entries(params)
		.filter(([, v]) => v !== undefined && v !== null)
		.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
	return parts.length > 0 ? `?${parts.join('&')}` : '';
}

export async function hawkbitRequest<T>(options: HawkbitRequestOptions): Promise<T> {
	const { method, path, body, query, headers = {}, timeout } = options;
	const url = `${hawkbitConfig.baseUrl}${path}${buildQueryString(query)}`;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeout ?? hawkbitConfig.timeout);

	try {
		const fetchHeaders: Record<string, string> = {
			Authorization: `Basic ${btoa(`${hawkbitConfig.username}:${hawkbitConfig.password}`)}`,
			...headers,
		};

		if (body && !(body instanceof FormData)) {
			fetchHeaders['Content-Type'] = 'application/json';
		}

		const response = await fetch(url, {
			method,
			headers: fetchHeaders,
			body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
			signal: controller.signal,
			...(hawkbitConfig.skipTls && { tls: { rejectUnauthorized: false } }),
		});

		if (!response.ok) {
			let errorBody: unknown;
			try {
				errorBody = await response.json();
			} catch {
				errorBody = await response.text();
			}

			appLogger.error({
				msg: 'hawkBit API error',
				status: response.status,
				endpoint: path,
				method,
				error: errorBody,
			});

			throw new HawkbitApiError(response.status, errorBody, path);
		}

		if (response.status === 204) return undefined as T;

		const contentType = response.headers.get('content-type') || '';
		if (contentType.includes('text/plain') || contentType.includes('application/octet-stream')) {
			return (await response.text()) as T;
		}

		return (await response.json()) as T;
	} catch (error) {
		if (error instanceof HawkbitApiError) throw error;
		// Wrap ALL network errors (connection refused, DNS failure, timeout)
		// in HawkbitApiError so route handlers can catch them consistently.
		// Bun fetch throws TypeError with "Unable to connect" on network failures.
		const message = error instanceof Error ? error.message : String(error);
		const status = (error as Error).name === 'AbortError' ? 408 : 503;
		appLogger.warn(`[HAWKBIT] Network error on ${method} ${path}: ${message}`);
		throw new HawkbitApiError(status, { error: message }, path);
	} finally {
		clearTimeout(timer);
	}
}
