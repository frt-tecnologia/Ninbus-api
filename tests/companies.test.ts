import { afterAll, describe, expect, it } from 'bun:test';
import { createApp } from '../src/app';
import { cleanAll } from './test-helpers';

afterAll(async () => {
	await cleanAll();
});

describe('Companies Module', () => {
	const app = createApp();
	const ownerEmail = `company-owner-${Date.now()}@example.com`;
	const memberEmail = `company-member-${Date.now()}@example.com`;
	const password = 'TestPassword123!';
	let ownerCookie: string;
	let memberCookie: string;
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

	describe('Unauthenticated Access', () => {
		it('GET /api/companies returns 401 without auth', async () => {
			const response = await app.handle(new Request('http://localhost/api/companies'));
			expect(response.status).toBe(401);
		});

		it('POST /api/companies returns 401 without auth', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/companies', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ name: 'Test Co' }),
				}),
			);
			expect(response.status).toBe(401);
		});
	});

	describe('CRUD', () => {
		it('POST /api/companies creates a company', async () => {
			ownerCookie = await signUpAndIn(ownerEmail, 'Company Owner');
			const response = await app.handle(
				new Request('http://localhost/api/companies', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ name: 'Ninbus Transit' }),
				}),
			);
			expect(response.status).toBe(201);
			const body = await response.json();
			expect(body.data.name).toBe('Ninbus Transit');
			companyId = body.data.id;
		});

		it('GET /api/companies lists user companies', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/companies', {
					headers: { Cookie: ownerCookie },
				}),
			);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.data.length).toBeGreaterThanOrEqual(1);
			expect(body.data.some((c: any) => c.id === companyId)).toBe(true);
		});

		it('GET /api/companies/:companyId returns company', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.data.id).toBe(companyId);
		});

		it('PUT /api/companies/:companyId updates company', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ name: 'Ninbus Transit Updated' }),
				}),
			);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.data.name).toBe('Ninbus Transit Updated');
		});

		it('GET /api/companies/:companyId returns 403 for non-member', async () => {
			memberCookie = await signUpAndIn(memberEmail, 'Non Member');
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}`, {
					headers: { Cookie: memberCookie },
				}),
			);
			expect(response.status).toBe(403);
		});
	});

	describe('Members', () => {
		it('GET /api/companies/:companyId/members lists members', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/members`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.data.length).toBeGreaterThanOrEqual(1);
			expect(body.data[0].role).toBe('owner');
		});

		it('POST /api/companies/:companyId/members rejects non-existent user', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/members`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({
						userId: 'nonexistent-user-id',
						role: 'viewer',
					}),
				}),
			);
			// Should reject invalid userId (FK violation) — not crash with 500
			expect([400, 404, 422]).toContain(response.status);
		});

		it('returns 403 for non-member accessing members', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/members`, {
					headers: { Cookie: memberCookie },
				}),
			);
			expect(response.status).toBe(403);
		});
	});

	describe('Validation', () => {
		it('POST /api/companies returns 400 for empty name', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/companies', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ name: '' }),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('POST /api/companies returns 400 for missing name', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/companies', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({}),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('GET /api/companies/:companyId returns 400 for invalid UUID', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/companies/not-a-uuid', {
					headers: { Cookie: ownerCookie },
				}),
			);
			expect(response.status).toBe(400);
		});
	});
});
