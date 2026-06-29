'use client';

import { createAuthClient } from 'better-auth/react';

/**
 * Better Auth client for the dashboard (client component only).
 *
 * All auth calls go through the SAME-ORIGIN Route Handler proxy at
 * `/api/auth/*`, which forwards to the API (`http://api:8081`) and repasses
 * the session cookie. The browser therefore NEVER calls the cross-origin API
 * directly.
 *
 * `baseURL` is intentionally OMITTED: better-auth builds
 * `${window.location.origin}${basePath}` at runtime (browser only). Passing a
 * baseURL makes better-auth eagerly validate it at MODULE LOAD, which throws
 * during SSR/prerender (`new URL('/')` is invalid). With no baseURL and no
 * `window`, no auth request runs server-side — exactly what we want.
 */
export const authClient = createAuthClient({
	basePath: '/api/auth',
	fetchOptions: {
		credentials: 'same-origin',
	},
});

export const { signIn, signOut, useSession } = authClient;
