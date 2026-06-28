import type { ApiError } from '@/types/domain';

/**
 * Low-level API client.
 *
 * All calls go through the same-origin proxy at `/api/*` (basePath `/admin`
 * already applied by Next). This client NEVER calls the external API URL
 * directly — that is the whole point of the proxy architecture.
 *
 * Throws `ApiClientError` on non-2xx so calling code can handle errors
 * uniformly (loading/error states in components).
 */

const BASE = '/admin/api';

export class ApiClientError extends Error {
	constructor(
		public readonly status: number,
		message: string,
		public readonly raw?: unknown,
	) {
		super(message);
		this.name = 'ApiClientError';
	}
}

type Query = Record<string, string | number | boolean | undefined | null>;

function buildUrl(path: string, query?: Query): string {
	const url = `${BASE}${path.startsWith('/') ? path : `/${path}`}`;
	if (!query) return url;
	const params = new URLSearchParams();
	for (const [k, v] of Object.entries(query)) {
		if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
	}
	const qs = params.toString();
	return qs ? `${url}?${qs}` : url;
}

async function request<T>(
	method: string,
	path: string,
	opts?: { body?: unknown; query?: Query },
): Promise<T> {
	const res = await fetch(buildUrl(path, opts?.query), {
		method,
		headers: opts?.body
			? { 'Content-Type': 'application/json' }
			: undefined,
		body: opts?.body ? JSON.stringify(opts.body) : undefined,
		credentials: 'same-origin', // send the session cookie
	});

	if (!res.ok) {
		let parsed: ApiError | null = null;
		try {
			parsed = (await res.json()) as ApiError;
		} catch {
			/* non-JSON error body */
		}
		throw new ApiClientError(
			res.status,
			parsed?.message ?? res.statusText ?? 'Request failed',
			parsed,
		);
	}

	// 204 No Content or empty body
	if (res.status === 204) return undefined as T;
	const text = await res.text();
	return (text ? JSON.parse(text) : undefined) as T;
}

export const http = {
	get: <T>(path: string, query?: Query) => request<T>('GET', path, { query }),
	post: <T>(path: string, body?: unknown) =>
		request<T>('POST', path, { body }),
	put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
	patch: <T>(path: string, body?: unknown) =>
		request<T>('PATCH', path, { body }),
	delete: <T>(path: string) => request<T>('DELETE', path),
};
