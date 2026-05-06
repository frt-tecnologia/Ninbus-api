import { describe, expect, it } from 'bun:test';
import { createApp } from '../src/app';

describe('Devices Module', () => {
	const app = createApp();
	const ownerEmail = `dev-owner-${Date.now()}@example.com`;
	const otherEmail = `dev-other-${Date.now()}@example.com`;
	const password = 'TestPassword123!';
	let ownerCookie: string;
	let otherCookie: string;
	let companyId: string;
	let deviceId: string;
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

	async function setupCompany(cookie: string): Promise<string> {
		const response = await app.handle(
			new Request('http://localhost/api/companies', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: cookie },
				body: JSON.stringify({ name: 'Device Test Company' }),
			}),
		);
		return (await response.json()).data.id;
	}

	async function createCategory(cookie: string, compId: string, type: string): Promise<string> {
		const response = await app.handle(
			new Request(`http://localhost/api/companies/${compId}/categories`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: cookie },
				body: JSON.stringify({ name: `Cat ${type}`, type }),
			}),
		);
		return (await response.json()).data.id;
	}

	describe('Setup', () => {
		it('creates company and categories', async () => {
			ownerCookie = await signUpAndIn(ownerEmail, 'Device Owner');
			otherCookie = await signUpAndIn(otherEmail, 'Other User');
			companyId = await setupCompany(ownerCookie);
			categoryId = await createCategory(ownerCookie, companyId, 'bus_line');
			expect(companyId).toBeDefined();
		});
	});

	describe('Unauthenticated', () => {
		it('returns 401 for all endpoints', async () => {
			const endpoints = [
				{ method: 'GET', url: `http://localhost/api/companies/${companyId}/devices` },
				{
					method: 'POST',
					url: `http://localhost/api/companies/${companyId}/devices`,
					body: { name: 'Test', serialNumber: 'SN-TEST-001' },
				},
			];
			for (const ep of endpoints) {
				const response = await app.handle(
					new Request(ep.url, {
						method: ep.method,
						headers: ep.body ? { 'Content-Type': 'application/json' } : undefined,
						body: ep.body ? JSON.stringify(ep.body) : undefined,
					}),
				);
				expect(response.status).toBe(401);
			}
		});
	});

	describe('Unauthorized', () => {
		it('returns 403 for non-member', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices`, {
					headers: { Cookie: otherCookie },
				}),
			);
			expect(response.status).toBe(403);
		});
	});

	describe('CRUD', () => {
		it('POST registers a device', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ name: 'Ninbus Bus #001', serialNumber: 'SN-001-AABB' }),
				}),
			);
			expect(response.status).toBe(201);
			const body = await response.json();
			expect(body.data.name).toBe('Ninbus Bus #001');
			expect(body.data.status).toBe('pending');
			deviceId = body.data.id;
		});

		it('GET lists company devices', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			expect(response.status).toBe(200);
			expect((await response.json()).data.length).toBeGreaterThanOrEqual(1);
		});

		it('GET /:deviceId returns device', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices/${deviceId}`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			expect(response.status).toBe(200);
			expect((await response.json()).data.id).toBe(deviceId);
		});

		it('PUT /:deviceId updates device', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices/${deviceId}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ name: 'Updated' }),
				}),
			);
			expect(response.status).toBe(200);
			expect((await response.json()).data.name).toBe('Updated');
		});

		it('DELETE /:deviceId removes device', async () => {
			const createRes = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ name: 'To Delete', serialNumber: 'SN-DELETE-001' }),
				}),
			);
			const deleteId = (await createRes.json()).data.id;
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices/${deleteId}`, {
					method: 'DELETE',
					headers: { Cookie: ownerCookie },
				}),
			);
			expect(response.status).toBe(200);
		});
	});

	describe('Category Assignment', () => {
		it('PUT assigns categories', async () => {
			const catId2 = await createCategory(ownerCookie, companyId, 'region');
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices/${deviceId}/categories`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ categoryIds: [categoryId, catId2] }),
				}),
			);
			expect(response.status).toBe(200);
		});

		it('GET returns device categories', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices/${deviceId}/categories`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			expect(response.status).toBe(200);
			expect((await response.json()).data.length).toBe(2);
		});
	});

	describe('Validation', () => {
		it('returns 400 for empty name', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ name: '' }),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('returns 400 for missing name', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({}),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('returns 404 for non-existent device', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices/11111111-1111-4111-8111-111111111111`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			expect(response.status).toBe(404);
		});
	});

	describe('hawkBit Integration', () => {
		it('GET /attributes returns 400 for unlinked device', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices/${deviceId}/attributes`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			expect(response.status).toBe(400);
		});

		it('GET /actions returns 400 for unlinked device', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices/${deviceId}/actions`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			expect(response.status).toBe(400);
		});
	});

	describe('Mode B Provisioning', () => {
		it('POST without deviceKey creates pending device', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({
						name: 'Pending Device',
						serialNumber: 'SN-PENDING-001',
					}),
				}),
			);
			expect(response.status).toBe(201);
			const body = await response.json();
			expect(body.data.status).toBe('pending');
			expect(body.data.hawkbitTargetId).toBeNull();
			expect(body.message).toBe('Device registered successfully');
		});

		it('POST without serialNumber returns 400', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ name: 'No Serial' }),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('PUT /:deviceId/link returns 404 for non-existent device', async () => {
			const response = await app.handle(
				new Request(
					`http://localhost/api/companies/${companyId}/devices/00000000-0000-0000-0000-000000000000/link`,
					{
						method: 'PUT',
						headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
						body: JSON.stringify({ deviceKey: 'factory-key-abc123' }),
					},
				),
			);
			expect(response.status).toBe(404);
		});

		it('PUT /:deviceId/link without auth returns 401', async () => {
			const response = await app.handle(
				new Request(
					`http://localhost/api/companies/${companyId}/devices/${deviceId}/link`,
					{
						method: 'PUT',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ deviceKey: 'factory-key-abc123' }),
					},
				),
			);
			expect(response.status).toBe(401);
		});

		it('PUT /:deviceId/link without body returns 400', async () => {
			const response = await app.handle(
				new Request(
					`http://localhost/api/companies/${companyId}/devices/${deviceId}/link`,
					{
						method: 'PUT',
						headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					},
				),
			);
			expect(response.status).toBe(400);
		});

		it('PUT /:deviceId/link with short deviceKey returns 400', async () => {
			const response = await app.handle(
				new Request(
					`http://localhost/api/companies/${companyId}/devices/${deviceId}/link`,
					{
						method: 'PUT',
						headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
						body: JSON.stringify({ deviceKey: 'short' }),
					},
				),
			);
			expect(response.status).toBe(400);
		});
	});
});
