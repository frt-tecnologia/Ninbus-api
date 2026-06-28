'use client';

import { createAuthClient } from 'better-auth/react';

/**
 * Better Auth client for the dashboard (client component only).
 *
 * All auth calls go through the same-origin proxy (`/admin/api/auth/*`), which
 * forwards to the API and repasses the session cookie. We NEVER point this
 * client at the external API URL (cross-origin cookie issue).
 *
 * `baseURL` must be a valid absolute URL (better-auth rejects host-less).
 * We use a placeholder origin and override `fetch` so the REAL request URL is
 * relative to the document origin in the browser. This keeps the build valid
 * (no window at prerender) AND routes browser calls correctly at runtime.
 */
export const authClient = createAuthClient({
	baseURL: 'http://placeholder/admin/api/auth',
	fetchOptions: {
		credentials: 'same-origin',
		// Rewrite the placeholder origin to a same-origin relative path at runtime.
		customFetch: (input: RequestInfo | URL, init?: RequestInit) => {
			let url = typeof input === 'string' ? input : input.toString();
			url = url.replace('http://placeholder', '');
			return fetch(url, init);
		},
	},
});

export const { signIn, signOut, useSession } = authClient;
