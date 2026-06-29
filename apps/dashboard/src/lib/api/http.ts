import ky, { HTTPError } from 'ky';
import type { ApiError } from '@/types/domain';

/**
 * Low-level API client — built on `ky` (https://github.com/sindresorhus/ky),
 * a modern, fetch-based request library. It replaces the previous hand-rolled
 * fetch wrapper and removes all the manual boilerplate: URL/query building,
 * JSON (de)serialization, timeout and HTTP-error decoding are handled by ky.
 *
 * All calls go through the same-origin Route Handler proxy at
 * `/console/api/*` (basePath '/console' already applied by Next). This client
 * NEVER calls the external API URL directly — that is the whole point of the
 * proxy architecture (the Better Auth session cookie is sameSite=lax and would
 * not travel cross-origin).
 *
 * This module is a thin TYPED FAÇADE over the shared `ky` instance so the
 * domain service modules (companies, devices, …) keep their clean
 * `http.get<T>(path)` signatures. ky's `HTTPError` is mapped to `ApiClientError`
 * so the UI hooks (useFetch/useMutation) read a stable `.message`.
 */

const PREFIX_URL = '/console/api';

const api = ky.create({
	prefix: PREFIX_URL,
	credentials: 'same-origin', // send the session cookie
	timeout: 30_000,
	retry: 0, // auth / validation / write errors are not retryable
});

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

type Query = Record<string, string | number | boolean | undefined>;

async function request<T>(
	method: 'get' | 'post' | 'put' | 'patch' | 'delete',
	path: string,
	opts?: { body?: unknown; query?: Query },
): Promise<T> {
	// ky 2.x `prefix` normalizes slashes at the join boundary, so a leading
	// `/` on `path` is handled automatically.
	try {
		const res = await api(path, {
			method,
			// ky drops undefined/null entries automatically.
			searchParams: opts?.query,
			// `json` makes ky set Content-Type + serialize the body.
			json: opts?.body,
		});
		// 204 No Content (or empty body) → nothing to parse.
		if (res.status === 204) return undefined as T;
		const text = await res.text();
		return (text ? JSON.parse(text) : undefined) as T;
	} catch (err) {
		if (err instanceof HTTPError) {
			let parsed: ApiError | null = null;
			try {
				parsed = (await err.response.json()) as ApiError;
			} catch {
				/* non-JSON error body */
			}
			throw new ApiClientError(
				err.response.status,
				parsed?.message ?? err.response.statusText ?? 'Request failed',
				parsed,
			);
		}
		// Network/abort errors surface as-is (useFetch treats them as unexpected).
		throw err;
	}
}

export const http = {
	get: <T>(path: string, query?: Query) => request<T>('get', path, { query }),
	post: <T>(path: string, body?: unknown) => request<T>('post', path, { body }),
	put: <T>(path: string, body?: unknown) => request<T>('put', path, { body }),
	patch: <T>(path: string, body?: unknown) => request<T>('patch', path, { body }),
	delete: <T>(path: string) => request<T>('delete', path),
};
