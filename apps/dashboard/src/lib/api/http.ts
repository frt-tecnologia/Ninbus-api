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
			// Multipart passthrough: `json:` would JSON.stringify a FormData into
			// `{}` (destroying the file) and send it as application/json. For
			// FormData, pass the raw body — fetch sets the multipart Content-Type
			// with the boundary automatically (required by t.File() endpoints).
			...(opts?.body instanceof FormData ? { body: opts.body as BodyInit } : { json: opts?.body }),
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

/** Result of a successful binary download (server-driven filename + forensic headers). */
export interface DownloadResult {
	filename: string;
	size: number;
	sha256?: string;
}

export const http = {
	get: <T>(path: string, query?: Query) => request<T>('get', path, { query }),
	post: <T>(path: string, body?: unknown) => request<T>('post', path, { body }),
	put: <T>(path: string, body?: unknown) => request<T>('put', path, { body }),
	patch: <T>(path: string, body?: unknown) => request<T>('patch', path, { body }),
	delete: <T>(path: string, query?: Query) => request<T>('delete', path, { query }),

	/**
	 * Binary download — GET expecting a FILE (not JSON). Saves via a transient
	 * object-URL anchor and returns filename + size (+ x-artifact-sha256 when
	 * the API provides it — byte-level provenance for forensic comparison).
	 */
	async download(path: string, opts?: { query?: Query }): Promise<DownloadResult> {
		const search = opts?.query
			? `?${new URLSearchParams(opts.query as Record<string, string>)}`
			: '';
		const res = await fetch(`${PREFIX_URL}${path}${search}`, { credentials: 'same-origin' });
		if (!res.ok) {
			let message = `Download failed (HTTP ${res.status})`;
			try {
				const parsed = (await res.json()) as ApiError;
				if (parsed?.message) message = parsed.message;
			} catch {
				/* non-JSON error body */
			}
			throw new ApiClientError(res.status, message);
		}
		const blob = await res.blob();
		const disposition = res.headers.get('content-disposition') ?? '';
		const match = /filename="?([^";]+)"?/.exec(disposition);
		const sizeHeader = Number(res.headers.get('x-artifact-size'));
		const filename = match?.[1] ?? 'artifact.bin';
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = filename;
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
		URL.revokeObjectURL(url);
		return {
			filename,
			size: Number.isFinite(sizeHeader) ? sizeHeader : blob.size,
			sha256: res.headers.get('x-artifact-sha256') ?? undefined,
		};
	},
};
