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
 * isSuperAdmin is NOT derivable from the session alone (it depends on the env
 * var SUPER_ADMIN_EMAILS, which lives on the API). So we call the API's
 * /admin/users (super admin only → 403 if the caller is not a super admin) OR
 * a dedicated /me endpoint. Here we probe /admin/companies: 200 = super admin,
 * 403 = not super admin, 401 = not authenticated.
 */

const PROXY_BASE = `${process.env.NEXT_PUBLIC_BASE_PATH ?? '/admin'}/api`;

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
	const res = await fetch(`${PROXY_BASE}/auth/get-session`, {
		headers: { cookie: cookieHeader },
		cache: 'no-store',
	});
	if (!res.ok) return null;
	const body = (await res.json()) as SessionPayload | null;
	return body?.user ?? null;
}

async function isPlatformAdmin(cookieHeader: string): Promise<boolean> {
	// Probe an admin endpoint. 200 = super admin, 401/403 = not.
	const res = await fetch(`${PROXY_BASE}/admin/companies`, {
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
		redirect('/admin/auth/login');
	}

	const admin = await isPlatformAdmin(cookieHeader);
	if (!admin) {
		redirect('/admin/auth/login?error=forbidden');
	}

	return user;
}
