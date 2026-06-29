import { NextResponse, type NextRequest } from 'next/server';

/**
 * Middleware — lightweight auth check before rendering.
 *
 * The authoritative super-admin guard is server-side (requireAdmin in the
 * admin layout). This middleware does a fast cookie presence check so unauthenticated
 * visitors get redirected to /auth/login before the layout even runs.
 *
 * Path logic:
 *  - /* (except /auth/* and /api/*) → require cookie.
 *  - everything else → passthrough.
 */
export function middleware(req: NextRequest) {
	const { pathname } = req.nextUrl;
	const isAdminArea = pathname.startsWith('/') && !pathname.startsWith('/auth/') && !pathname.startsWith('/api/');
	if (!isAdminArea) return NextResponse.next();

	const hasCookie = req.cookies.has('auth.session_token') || req.cookies.has('auth.session-token');
	if (!hasCookie) {
		const loginUrl = req.nextUrl.clone();
		loginUrl.pathname = '/auth/login';
		return NextResponse.redirect(loginUrl);
	}
	return NextResponse.next();
}

export const config = {
	// Run on everything under the app root EXCEPT static assets and the proxy.
	matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
