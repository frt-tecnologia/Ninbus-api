/**
 * Observability module integration tests.
 *
 * Covers the super-admin endpoints + the audit/telemetry capture:
 *  - GET /api/admin/activity (auth, filters, capture on mutation)
 *  - GET /api/admin/devices/connections (session bands, aggregate)
 *  - GET /api/admin/categories (cross-company aggregation)
 *
 * NOTE: these boot the full app via createApp(). On Bun 1.3.12 (Windows) there
 * is a pre-existing segfault at boot that is unrelated to this code; the suite
 * runs green in CI / on fixed Bun versions. See harness notes.
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { createApp } from '../src/app';
import { cleanAll } from './test-helpers';

afterAll(async () => {
	await cleanAll();
});

describe('Observability Module (super admin)', () => {
	const app = createApp();
	const superAdminEmail = 'admin-test@ninbus.com.br';
	const password = 'TestPassword123!';
	let superAdminCookie: string;
	let companyId: string;

	async function signUpAndIn(email: string, name: string): Promise<string> {
		await app.handle(
			new Request('http://localhost/api/auth/sign-up/email', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password, name }),
			}),
		);
		const signIn = await app.handle(
			new Request('http://localhost/api/auth/sign-in/email', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password }),
			}),
		);
		return signIn.headers.get('set-cookie') || '';
	}

	async function authReq(url: string, cookie: string, init: RequestInit = {}) {
		return app.handle(
			new Request(url, { ...init, headers: { Cookie: cookie, ...(init.headers as any) } }),
		);
	}

	describe('Auth & access control', () => {
		it('setup: signs in super admin', async () => {
			superAdminCookie = await signUpAndIn(superAdminEmail, 'Super Admin');
			expect(superAdminCookie).toBeTruthy();
		});

		it('GET /api/admin/activity → 401 without auth', async () => {
			const res = await app.handle(new Request('http://localhost/api/admin/activity'));
			expect(res.status).toBe(401);
		});

		it('GET /api/admin/activity → 403 for non-super-admin', async () => {
			const regular = await signUpAndIn(`obs-regular-${Date.now()}@example.com`, 'Regular');
			const res = await authReq('http://localhost/api/admin/activity', regular);
			expect(res.status).toBe(403);
		});

		it('GET /api/admin/activity → 200 for super admin', async () => {
			const res = await authReq('http://localhost/api/admin/activity', superAdminCookie);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toHaveProperty('data');
			expect(body).toHaveProperty('hasMore');
			expect(Array.isArray(body.data)).toBe(true);
		});
	});

	describe('Audit capture on mutation', () => {
		it('creating a company logs a company.created event', async () => {
			const res = await authReq('http://localhost/api/companies', superAdminCookie, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: `Obs Co ${Date.now()}`,
					ownerEmail: `obs-owner-${Date.now()}@example.com`,
				}),
			});
			expect(res.status).toBe(201);
			const created = await res.json();
			companyId = created.data.id;

			// The audit feed should now contain the company.created event.
			const feed = await authReq(
				`http://localhost/api/admin/activity?companyId=${companyId}&action=company.created`,
				superAdminCookie,
			);
			const body = await feed.json();
			const match = body.data.find((e: any) => e.entityId === companyId);
			expect(match).toBeDefined();
			expect(match.action).toBe('company.created');
			expect(match.actorEmail).toBe(superAdminEmail);
		});

		it('filtering by entityType returns only that type', async () => {
			const res = await authReq(
				'http://localhost/api/admin/activity?entityType=company',
				superAdminCookie,
			);
			const body = await res.json();
			for (const e of body.data) {
				expect(e.entityType).toBe('company');
			}
		});
	});

	describe('Device connections timeline', () => {
		it('GET /devices/connections requires from + to', async () => {
			// Missing from/to → 400 (Elysia validation)
			const res = await authReq('http://localhost/api/admin/devices/connections', superAdminCookie);
			expect(res.status).toBe(400);
		});

		it('GET /devices/connections returns session view for a short range', async () => {
			const to = new Date();
			const from = new Date(to.getTime() - 3600_000); // 1h
			const res = await authReq(
				`http://localhost/api/admin/devices/connections?from=${from.toISOString()}&to=${to.toISOString()}&companyId=${companyId}`,
				superAdminCookie,
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.view).toBe('session');
			expect(body).toHaveProperty('range');
			expect(body).toHaveProperty('total');
			expect(Array.isArray(body.data)).toBe(true);
		});

		it('auto-selects aggregate view for a long range (>7d)', async () => {
			const to = new Date();
			const from = new Date(to.getTime() - 30 * 86_400_000); // 30d
			const res = await authReq(
				`http://localhost/api/admin/devices/connections?from=${from.toISOString()}&to=${to.toISOString()}`,
				superAdminCookie,
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.view).toBe('aggregate');
		});
	});

	describe('Aggregated categories', () => {
		it('GET /categories returns cross-company list with device counts', async () => {
			const res = await authReq('http://localhost/api/admin/categories', superAdminCookie);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(Array.isArray(body.data)).toBe(true);
			for (const c of body.data) {
				expect(c).toHaveProperty('deviceCount');
				expect(c).toHaveProperty('companyName');
			}
		});
	});
});
