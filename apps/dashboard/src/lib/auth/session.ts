import ky from 'ky';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

/**
 * Server-side session resolution for the dashboard.
 *
 * Used by server components/layouts to:
 *  1. Check if the visitor is authenticated (redirect to /auth/login if not).
 *  2. Check if the authenticated user is a super admin (redirect to a 403 page
 *     if not — only SUPER_ADMIN_EMAILS may access the dashboard).
 *
 * Server components call the API DIRECTLY over the compose network
 * (http://api:8081) — they do NOT go through the Route Handler proxy (that
 * proxy exists for the BROWSER, which is cross-origin to the API). A
 * server-side fetch() needs an ABSOLUTE url (there is no document origin),
 * so we use API_INTERNAL_URL rather than a same-origin path.
 *
 * isSuperAdmin is NOT derivable from the session alone (it depends on the env
 * var SUPER_ADMIN_EMAILS, which lives on the API). We probe /api/admin/companies:
 * 200 = super admin, 403 = not super admin, 401 = not authenticated.
 */

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://api:8081';

/**
 * Server-side `ky` instance that talks to the API DIRECTLY over the compose
 * network (not through the browser Route Handler proxy, which is for the
 * browser). `throwHttpErrors: false` lets us inspect `res.ok` to distinguish
 * 401/403 from 200 instead of catching thrown errors.
 */
const serverApi = ky.create({
	prefix: API_INTERNAL_URL,
	throwHttpErrors: false,
	timeout: 10_000,
});

interface SessionUser {
	id: string;
	name: string;
	email: string;
	image: string | null;
}

interface SessionPayload {
	user: SessionUser | null;
}

async function fetchSession(cookieHeader: string): Promise<SessionUser | null> {
	const res = await serverApi('api/auth/get-session', {
		headers: { cookie: cookieHeader },
		cache: 'no-store',
	});
	if (!res.ok) return null;
	const body = (await res.json()) as SessionPayload | null;
	return body?.user ?? null;
}

async function isPlatformAdmin(cookieHeader: string): Promise<boolean> {
	// Probe an admin-only endpoint. 200 = super admin, 401/403 = not.
	// The API mounts platform routes under /api/admin/*.
	const res = await serverApi('api/admin/companies', {
		headers: { cookie: cookieHeader },
		cache: 'no-store',
	});
	return res.ok;
}

/**
 * Guard for admin pages (server components).
 * Returns the authenticated user or redirects.
 */
export async function requireAdmin(): Promise<SessionUser> {
	const cookieStore = await cookies();
	const cookieHeader = cookieStore.toString();

	const user = await fetchSession(cookieHeader);
	if (!user) {
		redirect('/auth/login');
	}

	const admin = await isPlatformAdmin(cookieHeader);
	if (!admin) {
		redirect('/auth/login?error=forbidden');
	}

	return user;
}
