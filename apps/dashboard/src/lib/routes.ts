/**
 * Typed route map — the SINGLE source of truth for dashboard paths.
 *
 * Why this exists: with Next.js App Router, navigation helpers (`next/link`,
 * `useRouter().push`, `redirect`) auto-apply basePath '/admin'. Writing
 * `'/overview'` instead of `'/admin/overview'` is correct but error-prone —
 * a typo routes to a 404. This map gives every route a named constant so
 * navigation is typed and refactor-safe. React Router is NOT used here: this
 * is a Next.js App Router app, where file-based routing + next/link already
 * provide professional, performant client-side navigation with automatic
 * prefetch and per-route code-splitting. React Router would conflict with
 * the server-component router and break SSR.
 *
 * Paths are basePath-stripped (no '/admin' prefix) — Next applies it.
 */
export const ROUTES = {
	overview: '/overview',
	devices: '/devices',
	companies: '/companies',
	users: '/users',
	deployments: '/deployments',
	designations: '/designations',
	login: '/auth/login',
	resetPassword: '/auth/reset-password',
} as const;

export type RouteKey = keyof typeof ROUTES;
export type RoutePath = (typeof ROUTES)[RouteKey];

/** Build a route path with params, e.g. routeFor('devices', { companyId }). */
export function routeFor(
	key: RouteKey,
	params?: Record<string, string>,
): string {
	let path: string = ROUTES[key];
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			path = path.replace(`:${k}`, v);
		}
	}
	return path;
}
