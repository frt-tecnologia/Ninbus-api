import { describe, expect, it } from 'bun:test';
import { createApp } from '../src/app';

describe('Categories Module', () => {
	const app = createApp();
	const ownerEmail = `cat-owner-${Date.now()}@example.com`;
	const password = 'TestPassword123!';
	let ownerCookie: string;
	let companyId: string;
	let categoryId: string;

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

	async function createCompany(cookie: string): Promise<string> {
		const response = await app.handle(
			new Request('http://localhost/api/companies', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: cookie },
				body: JSON.stringify({ name: 'Cat Test Company' }),
			}),
		);
		const body = await response.json();
		return body.data.id;
	}

	describe('CRUD', () => {
		it('setup: creates company', async () => {
			ownerCookie = await signUpAndIn(ownerEmail, 'Category Owner');
			companyId = await createCompany(ownerCookie);
			expect(companyId).toBeDefined();
		});

		it('POST creates a category', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/categories`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({
						name: 'Linha Central',
						type: 'bus_line',
						description: 'Ônibus da linha central',
					}),
				}),
			);
			expect(response.status).toBe(201);
			const body = await response.json();
			expect(body.data.name).toBe('Linha Central');
			expect(body.data.type).toBe('bus_line');
			categoryId = body.data.id;
		});

		it('GET lists categories', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/categories`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.data.length).toBeGreaterThanOrEqual(1);
		});

		it('GET /:categoryId returns category', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/categories/${categoryId}`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.data.id).toBe(categoryId);
		});

		it('PUT /:categoryId updates category', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/categories/${categoryId}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ name: 'Linha Norte' }),
				}),
			);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.data.name).toBe('Linha Norte');
		});

		it('DELETE /:categoryId deletes category', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/categories/${categoryId}`, {
					method: 'DELETE',
					headers: { Cookie: ownerCookie },
				}),
			);
			expect(response.status).toBe(200);
		});
	});

	describe('Multiple category types', () => {
		it('creates categories of different types', async () => {
			const types = ['bus_line', 'garage', 'yard', 'region', 'custom'];
			for (const type of types) {
				const response = await app.handle(
					new Request(`http://localhost/api/companies/${companyId}/categories`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
						body: JSON.stringify({ name: `Category ${type}`, type }),
					}),
				);
				expect(response.status).toBe(201);
			}
		});
	});

	describe('Validation', () => {
		it('returns 400 for empty name', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/categories`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ name: '', type: 'custom' }),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('returns 400 for invalid type', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/categories`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ name: 'Test', type: 'invalid_type' }),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('returns 400 for missing body', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/categories`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({}),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('returns 401 without auth', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/categories`),
			);
			expect(response.status).toBe(401);
		});

		it('returns 403 for non-member', async () => {
			const otherEmail = `cat-other-${Date.now()}@example.com`;
			const otherCookie = await signUpAndIn(otherEmail, 'Other User');
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/categories`, {
					headers: { Cookie: otherCookie },
				}),
			);
			expect(response.status).toBe(403);
		});
	});
});
