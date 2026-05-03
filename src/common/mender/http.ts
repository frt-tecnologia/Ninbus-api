import { menderConfig } from '@common/config/mender';
/**
 * Mender Gateway HTTP Client — Core infrastructure.
 *
 * Centralized client for all Mender API calls.
 * Injects PAT + Host header + tenant token automatically.
 *
 * @see mender-server/backend/docs/ARCHITECTURE_GUIDE.md
 */
import { appLogger } from '@common/logger';

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class MenderApiError extends Error {
	constructor(
		public readonly status: number,
		public readonly body: unknown,
		public readonly endpoint: string,
	) {
		super(`Mender API error ${status} on ${endpoint}: ${JSON.stringify(body)}`);
		this.name = 'MenderApiError';
	}
}

// ---------------------------------------------------------------------------
// HTTP infrastructure
// ---------------------------------------------------------------------------

interface MenderRequestOptions {
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

export async function menderRequest<T>(options: MenderRequestOptions): Promise<T> {
	const { method, path, body, query, headers = {}, timeout } = options;
	const url = `${menderConfig.baseUrl}${path}${buildQueryString(query)}`;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeout ?? menderConfig.timeout);

	try {
		const fetchHeaders: Record<string, string> = {
			Authorization: `Bearer ${menderConfig.pat}`,
			...headers,
		};

		// Host override: Traefik routes by Host header.
		// Required when using host.docker.internal instead of localhost.
		if (menderConfig.hostOverride) {
			fetchHeaders['Host'] = menderConfig.hostOverride;
		}

		// Tenant token for multi-tenant Mender setups
		if (menderConfig.tenantToken) {
			fetchHeaders['X-Mender-Tenant-Token'] = menderConfig.tenantToken;
		}

		if (body && !(body instanceof FormData)) {
			fetchHeaders['Content-Type'] = 'application/json';
		}

		const response = await fetch(url, {
			method,
			headers: fetchHeaders,
			body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
			signal: controller.signal,
			// TLS skip for self-signed certs in dev/Docker
			...(menderConfig.skipTls && { tls: { rejectUnauthorized: false } }),
		});

		if (!response.ok) {
			let errorBody: unknown;
			try {
				errorBody = await response.json();
			} catch {
				errorBody = await response.text();
			}

			appLogger.error({
				msg: 'Mender API error',
				status: response.status,
				endpoint: path,
				method,
				error: errorBody,
			});

			throw new MenderApiError(response.status, errorBody, path);
		}

		if (response.status === 204) return undefined as T;

		const contentType = response.headers.get('content-type') || '';
		if (contentType.includes('text/plain') || contentType.includes('application/octet-stream')) {
			return (await response.text()) as T;
		}

		return (await response.json()) as T;
	} catch (error) {
		if (error instanceof MenderApiError) throw error;
		if ((error as Error).name === 'AbortError') {
			throw new MenderApiError(408, { error: 'Request timeout' }, path);
		}
		throw error;
	} finally {
		clearTimeout(timer);
	}
}
