import { afterAll, describe, expect, it } from 'bun:test';
import { createApp } from '../src/app';
import { cleanAll } from './test-helpers';

afterAll(async () => {
	await cleanAll();
});

/**
 * Tests for provisioning routes:
 * - POST /provision         → super admin only
 * - GET /unclaimed          → super admin only
 * - POST /sync              → super admin only
 * - GET /search             → super admin only
 * - DELETE /deprovision/:sn → super admin only
 *
 * SUPER_ADMIN_EMAILS=admin-test@ninbus.com.br in .env.test
 */
describe('Provisioning', () => {
	const app = createApp();
	const ts = Date.now();
	const superAdminEmail = `admin-test@ninbus.com.br`;
	const normalEmail = `provision-normal-${ts}@example.com`;
	const password = 'TestPassword123!';
	let superAdminCookie: string;
	let normalCookie: string;

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

	it('setup: creates super admin and normal user', async () => {
		superAdminCookie = await signUpAndIn(superAdminEmail, 'Super Admin');
		normalCookie = await signUpAndIn(normalEmail, 'Normal User');
		expect(superAdminCookie).toBeTruthy();
		expect(normalCookie).toBeTruthy();
	}, 10000);

	describe('POST /sync — Super Admin Only', () => {
		it('returns 401 without auth', async () => {
			const r = await app.handle(new Request('http://localhost/api/devices/sync', { method: 'POST' }));
			expect(r.status).toBe(401);
		});

		it('returns 403 for normal user', async () => {
			const r = await app.handle(new Request('http://localhost/api/devices/sync', { method: 'POST', headers: { Cookie: normalCookie } }));
			expect(r.status).toBe(403);
		});

		it('returns 400 when auto-provisioning disabled', async () => {
			const r = await app.handle(new Request('http://localhost/api/devices/sync', { method: 'POST', headers: { Cookie: superAdminCookie } }));
			expect(r.status).toBe(400);
			expect((await r.json()).message).toContain('Auto-provisioning is disabled');
		});
	}, 10000);

	describe('GET /search — Super Admin Only', () => {
		it('returns 401 without auth', async () => {
			const r = await app.handle(new Request('http://localhost/api/devices/search?serialNumber=ABC'));
			expect(r.status).toBe(401);
		});

		it('returns 403 for normal user', async () => {
			const r = await app.handle(new Request('http://localhost/api/devices/search?serialNumber=ABC', { headers: { Cookie: normalCookie } }));
			expect(r.status).toBe(403);
		});

		it('returns 400 when serialNumber is empty', async () => {
			const r = await app.handle(new Request('http://localhost/api/devices/search?serialNumber=', { headers: { Cookie: superAdminCookie } }));
			expect(r.status).toBe(400);
		});

		it('returns 200 with results for super admin', async () => {
			const r = await app.handle(new Request('http://localhost/api/devices/search?serialNumber=ZZZZ', { headers: { Cookie: superAdminCookie } }));
			expect(r.status).toBe(200);
			const body = await r.json();
			expect(body.data).toBeArray();
			expect(body.total).toBeNumber();
		});
	});

	describe('DELETE /deprovision/:serialNumber — Super Admin Only', () => {
		it('returns 401 without auth', async () => {
			const r = await app.handle(new Request('http://localhost/api/devices/deprovision/AABBCCDD', { method: 'DELETE' }));
			expect(r.status).toBe(401);
		});

		it('returns 403 for normal user', async () => {
			const r = await app.handle(new Request('http://localhost/api/devices/deprovision/AABBCCDD', { method: 'DELETE', headers: { Cookie: normalCookie } }));
			expect(r.status).toBe(403);
		});

		it('returns 400 when hawkBit disabled', async () => {
			const r = await app.handle(new Request('http://localhost/api/devices/deprovision/AABBCCDD', { method: 'DELETE', headers: { Cookie: superAdminCookie } }));
			// HAWKBIT_ENABLED=false in .env.test → 400
			expect(r.status).toBe(400);
			expect((await r.json()).message).toContain('hawkBit integration is disabled');
		});
	});

	describe('GET /unclaimed — Super Admin Only', () => {
		it('returns 401 without auth', async () => {
			const r = await app.handle(new Request('http://localhost/api/devices/unclaimed'));
			expect(r.status).toBe(401);
		});

		it('returns 403 for normal user', async () => {
			const r = await app.handle(new Request('http://localhost/api/devices/unclaimed', {
				headers: { Cookie: normalCookie },
			}));
			expect(r.status).toBe(403);
		});

		it('returns 200 for super admin', async () => {
			const r = await app.handle(new Request('http://localhost/api/devices/unclaimed', {
				headers: { Cookie: superAdminCookie },
			}));
			expect(r.status).toBe(200);
			const body = await r.json();
			expect(body.data).toBeArray();
			expect(body.total).toBeNumber();
		});
	});

	describe('POST /provision — Super Admin Only', () => {
		it('returns 401 without auth', async () => {
			const r = await app.handle(new Request('http://localhost/api/devices/provision', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ serialNumber: 'AA11', deviceKey: 'test-key' }),
			}));
			expect(r.status).toBe(401);
		});

		it('returns 403 for normal user', async () => {
			const serial = `AA11${ts.toString(16).toUpperCase().padStart(12, '0')}`;
			const r = await app.handle(new Request('http://localhost/api/devices/provision', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: normalCookie },
				body: JSON.stringify({ serialNumber: serial, deviceKey: 'test-key-12345678' }),
			}));
			expect(r.status).toBe(403);
		});

		it('allows super admin to provision', async () => {
			const serial = `BB22${ts.toString(16).toUpperCase().padStart(12, '0')}`;
			const r = await app.handle(new Request('http://localhost/api/devices/provision', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: superAdminCookie },
				body: JSON.stringify({ serialNumber: serial, deviceKey: 'test-key-12345678' }),
			}));
			expect(r.status).toBe(201);
		});
	});
});
