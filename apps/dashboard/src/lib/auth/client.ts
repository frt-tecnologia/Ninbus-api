'use client';

import { createAuthClient } from 'better-auth/react';

/**
 * Better Auth client for the dashboard (client component only).
 *
 * All auth calls go through the SAME-ORIGIN Route Handler proxy at
 * `/admin/api/auth/*` (basePath '/admin' already applied by Next), which
 * forwards to the API (`http://api:8081`) and repasses the session cookie.
 * The browser therefore NEVER calls the cross-origin API directly.
 *
 * `baseURL` resolution (better-auth `getBaseURL`, config.mjs):
 *   when `baseURL` is omitted but `window` exists, better-auth builds
 *   `${window.location.origin}${basePath}`. That yields a REAL absolute,
 *   SAME-ORIGIN URL — e.g. `http://localhost:3001/admin/api/auth` (dev) or
 *   `https://ninbus.frt.com.br/admin/api/auth` (prod). Same-origin means:
 *     • NO CORS preflight (so no cross-origin cookie problem),
 *     • the request actually resolves (no fake host like `placeholder`).
 *
 * DO NOT pass `baseURL` here: better-auth hardcodes the fetch to native
 * `fetch` (`customFetchImpl: fetch`), and a previous attempt to rewrite the
 * URL via `fetchOptions.customFetch` was silently ignored — the browser then
 * tried to resolve the literal host `placeholder` and the request hung. The
 * `basePath` option is the supported, build-safe way (no `window` at SSR just
 * falls back harmlessly — no auth requests run server-side).
 */
export const authClient = createAuthClient({
	basePath: '/admin/api/auth',
	fetchOptions: {
		credentials: 'same-origin',
	},
});

export const { signIn, signOut, useSession } = authClient;
