/**
 * Regression tests for buildAppDeepLink — email links must be clickable on mobile.
 *
 * Context: links of the form `ninbus://reset-password?token=...` are NOT
 * clickable inside most mobile email clients (Gmail, Outlook, Yahoo strip
 * non-http(s) hrefs as an anti-phishing measure). The fix is to use an https
 * App Link (https://ninbus.frt.com.br). These tests lock that behavior in.
 *
 * See docs/email-app-link-plan.md for the full rationale.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

const { buildAppDeepLink } = await import('@common/config/deep-link');
const { env } = await import('@common/config/env');

const savedDeepLink = env.APP_DEEP_LINK_BASE;
const savedFrontend = env.FRONTEND_URL;

beforeEach(() => {
	// Reset to the production-like default between tests.
	env.APP_DEEP_LINK_BASE = 'https://ninbus.frt.com.br';
	env.FRONTEND_URL = undefined;
});

afterEach(() => {
	env.APP_DEEP_LINK_BASE = savedDeepLink;
	env.FRONTEND_URL = savedFrontend;
});

describe('buildAppDeepLink — mobile-clickable https links', () => {
	test('https App Link base → link starts with https:// and is clickable', () => {
		const link = buildAppDeepLink('http://api/original', 'tok-123', 'reset-password');
		expect(link).toBe('https://ninbus.frt.com.br/reset-password?token=tok-123');
		// The property that makes it clickable in Gmail/Outlook/Yahoo:
		expect(link.startsWith('https://')).toBe(true);
	});

	test('https base → verify-email path', () => {
		const link = buildAppDeepLink('http://api/original', 'abc', 'verify-email');
		expect(link).toBe('https://ninbus.frt.com.br/verify-email?token=abc');
	});

	test('token with special chars is URL-encoded', () => {
		const link = buildAppDeepLink('http://api/original', 'a/b c=1&d', 'reset-password');
		expect(link).toBe('https://ninbus.frt.com.br/reset-password?token=a%2Fb%20c%3D1%26d');
	});

	test('custom scheme base is still supported (dev fallback) but NOT the default', () => {
		env.APP_DEEP_LINK_BASE = 'ninbus://';
		const link = buildAppDeepLink('http://api/original', 'tok', 'reset-password');
		// Correctly formed (no double slash issue)...
		expect(link).toBe('ninbus://reset-password?token=tok');
		// ...but documented as non-clickable in mobile email clients.
		expect(link.startsWith('https://')).toBe(false);
	});

	test('falls back to FRONTEND_URL when APP_DEEP_LINK_BASE is unset', () => {
		env.APP_DEEP_LINK_BASE = undefined;
		env.FRONTEND_URL = 'https://app.ninbus.frt.com.br';
		const link = buildAppDeepLink('http://api/original', 'tok', 'reset-password');
		expect(link).toBe('https://app.ninbus.frt.com.br/reset-password?token=tok');
	});

	test('falls back to the original Better Auth URL (and warns) when neither is set', () => {
		env.APP_DEEP_LINK_BASE = undefined;
		env.FRONTEND_URL = undefined;
		const original = 'http://api:8081/api/auth/reset-password?token=tok';
		const link = buildAppDeepLink(original, 'tok', 'reset-password');
		expect(link).toBe(original);
	});

	test('leading slashes in path are normalized', () => {
		const link = buildAppDeepLink('http://api/original', 'tok', '///reset-password');
		expect(link).toBe('https://ninbus.frt.com.br/reset-password?token=tok');
	});
});
