import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createApp } from '../src/app';
import { cleanAll } from './test-helpers';

afterAll(async () => {
	await cleanAll();
});

/**
 * Tests for SSE endpoint:
 * - GET /api/companies/:companyId/sse → SSE stream with auth
 * - Requires authenticated user + company membership
 */
describe('SSE Module', () => {
	const app = createApp();
	const ts = Date.now();
	const ownerEmail = `sse-owner-${ts}@example.com`;
	const otherEmail = `sse-other-${ts}@example.com`;
	const password = 'TestPassword123!';
	let ownerCookie: string;
	let otherCookie: string;
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

	beforeAll(async () => {
		ownerCookie = await signUpAndIn(ownerEmail, 'SSE Owner');
		otherCookie = await signUpAndIn(otherEmail, 'Other User');

		// Create company
		const response = await app.handle(
			new Request('http://localhost/api/companies', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
				body: JSON.stringify({ name: 'SSE Test Company' }),
			}),
		);
		const body = await response.json();
		companyId = body.data.id;
	}, 10000);

	describe('Auth guards', () => {
		it('returns 401 without auth', async () => {
			const r = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/sse`),
			);
			expect(r.status).toBe(401);
		});

		it('returns 403 for non-member', async () => {
			const r = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/sse`, {
					headers: { Cookie: otherCookie },
				}),
			);
			expect(r.status).toBe(403);
		});
	});

	describe('SSE connection', () => {
		it('returns text/event-stream for authenticated member', async () => {
			const r = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/sse`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			expect(r.status).toBe(200);
			expect(r.headers.get('content-type')).toContain('text/event-stream');
			expect(r.headers.get('cache-control')).toContain('no-cache');
			expect(r.body).toBeDefined();

			// Read initial events from the stream
			const reader = r.body!.getReader();

			// Read first chunk — should contain 'connected' event
			const { value } = await reader.read();
			// Elysia app.handle() serializes Uint8Array as JSON indexed object {"0":105,"1":100,...}
			// Convert back to Uint8Array then decode
			let text: string;
			if (typeof value === 'string') {
				try {
					const parsed = JSON.parse(value);
					if (typeof parsed === 'object' && parsed !== null) {
						const bytes = Object.keys(parsed).length;
						const arr = new Uint8Array(bytes);
						for (const [k, v] of Object.entries(parsed)) arr[Number(k)] = v as number;
						text = new TextDecoder().decode(arr);
					} else {
						text = value;
					}
				} catch {
					text = value;
				}
			} else if (value instanceof Uint8Array) {
				text = new TextDecoder().decode(value);
			} else {
				text = String(value);
			}

			expect(text).toContain('event: connected');
			expect(text).toContain(`"companyId":"${companyId}"`);
			expect(text).toContain('timestamp');

			reader.cancel();
		});

		it('stream contains valid SSE format (id + event + data)', async () => {
			const r = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/sse`, {
					headers: { Cookie: ownerCookie },
				}),
			);

			const reader = r.body!.getReader();
			const { value } = await reader.read();
			let text: string;
			if (typeof value === 'string') {
				try {
					const parsed = JSON.parse(value);
					if (typeof parsed === 'object' && parsed !== null) {
						const bytes = Object.keys(parsed).length;
						const arr = new Uint8Array(bytes);
						for (const [k, v] of Object.entries(parsed)) arr[Number(k)] = v as number;
						text = new TextDecoder().decode(arr);
					} else { text = value; }
				} catch { text = value; }
			} else if (value instanceof Uint8Array) {
				text = new TextDecoder().decode(value);
			} else { text = String(value); }

			// SSE format: id: N\nevent: name\ndata: {...}\n\n
			expect(text).toMatch(/^id: \d+\n/);
			expect(text).toMatch(/\nevent: \w+\n/);
			expect(text).toMatch(/\ndata: \{.*\}\n\n$/);

			reader.cancel();
		});
	});
});
