import { appLogger } from '@common/logger';
import { env } from './env';

/**
 * Build an app deep link from a Better Auth callback URL and token.
 *
 * Better Auth generates `url` using BETTER_AUTH_URL (which points at the API).
 * We rewrite it to a link the mobile app can intercept:
 *   - Prefer APP_DEEP_LINK_BASE (custom scheme like "ninbus://" or an https
 *     App Link like "https://ninbus.frt.com.br").
 *   - Fall back to FRONTEND_URL (web).
 *   - Fall back to the original Better Auth URL (best effort) + warn.
 *
 * IMPORTANT — why we default to an https App Link, NOT a custom scheme:
 * Custom schemes ("ninbus://...") are NOT clickable inside most mobile email
 * clients (Gmail, Outlook, Yahoo strip non-http(s) hrefs as an anti-phishing
 * measure). An https App Link ("https://ninbus.frt.com.br/...") is clickable
 * everywhere AND opens the app directly when the domain is verified
 * (App Links on Android, Universal Links on iOS). See docs/email-app-link-plan.md.
 *
 * Result examples:
 *   https base  → "https://ninbus.frt.com.br/reset-password?token=XXX"
 *   scheme base → "ninbus://reset-password?token=XXX"  (dev fallback only)
 */
export function buildAppDeepLink(originalUrl: string, token: string, path: string): string {
	const base = env.APP_DEEP_LINK_BASE ?? env.FRONTEND_URL;
	if (!base) {
		appLogger.warn(
			{ path },
			'Neither APP_DEEP_LINK_BASE nor FRONTEND_URL is set — email links will point at the API (BETTER_AUTH_URL). Set APP_DEEP_LINK_BASE (e.g. https://ninbus.frt.com.br) to route links into the mobile app.',
		);
		return originalUrl;
	}
	const cleanPath = path.replace(/^\/+/, '');
	// Custom schemes (e.g. "ninbus://") end with "://" — append the path directly
	// so we get "ninbus://reset-password" (not "ninbus:/reset-password").
	// Host-based URLs (e.g. "https://ninbus.frt.com.br") need a "/" separator.
	const separator = base.endsWith('://') ? '' : '/';
	return `${base}${separator}${cleanPath}?token=${encodeURIComponent(token)}`;
}
