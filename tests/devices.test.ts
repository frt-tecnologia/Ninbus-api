import { afterAll, describe, expect, it } from 'bun:test';
import { createApp } from '../src/app';
import { cleanAll } from './test-helpers';

afterAll(async () => {
	await cleanAll();
});

describe('Devices Module', () => {
	const app = createApp();
	const ts = Date.now();
	const ownerEmail = `dev-owner-${ts}@example.com`;
	const otherEmail = `dev-other-${ts}@example.com`;
	const superAdminEmail = 'admin-test@ninbus.com.br';
	const password = 'TestPassword123!';
	const testSerial = `FF19E0EB${ts.toString(16).toUpperCase().slice(-8).padStart(8, '0')}`; // valid 16-char hex serial (8 bytes)
	let ownerCookie: string;
	let otherCookie: string;
	let superAdminCookie: string;
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

	async function setupCompany(ownerEmail: string): Promise<string> {
		// Company creation requires super admin. Sign in as super admin and create.
		const response = await app.handle(
			new Request('http://localhost/api/companies', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: superAdminCookie },
				body: JSON.stringify({ name: 'Device Test Company', ownerEmail }),
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
			superAdminCookie = await signUpAndIn(superAdminEmail, 'Super Admin');
			ownerCookie = await signUpAndIn(ownerEmail, 'Device Owner');
			otherCookie = await signUpAndIn(otherEmail, 'Other User');
			companyId = await setupCompany(ownerEmail);
			categoryId = await createCategory(ownerCookie, companyId, 'bus_line');
			expect(companyId).toBeDefined();
		}, 10000);
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
		it('POST provisions and claims a device', async () => {
			// Step 1: Provision device (factory)
			const provResponse = await app.handle(
				new Request('http://localhost/api/devices/provision', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: superAdminCookie },
					body: JSON.stringify({
						serialNumber: testSerial,
						deviceKey: 'test-factory-key-12345678',
						name: 'Ninbus Bus #001',
					}),
				}),
			);
			expect(provResponse.status).toBe(201);

			// Step 2: Claim device for company
			const claimResponse = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ name: 'Ninbus Bus #001', serialNumber: testSerial }),
				}),
			);
			expect(claimResponse.status).toBe(201);
			const body = await claimResponse.json();
			expect(body.data.name).toBe('Ninbus Bus #001');
			expect(body.data.companyId).toBe(companyId);
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
			const delSerial = `CC00DD${(ts + 99).toString(16).toUpperCase().padStart(10, '0')}`; // 16 hex chars
			// Provision first
			await app.handle(
				new Request('http://localhost/api/devices/provision', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: superAdminCookie },
					body: JSON.stringify({ serialNumber: delSerial, deviceKey: 'test-del-key-12345678' }),
				}),
			);
			const createRes = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ name: 'To Delete', serialNumber: delSerial }),
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
				new Request(
					`http://localhost/api/companies/${companyId}/devices/11111111-1111-4111-8111-111111111111`,
					{
						headers: { Cookie: ownerCookie },
					},
				),
			);
			expect(response.status).toBe(404);
		});
	});

	describe('hawkBit Integration', () => {
		it('GET /attributes returns 400 when hawkBit disabled', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices/${deviceId}/attributes`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			// With HAWKBIT_ENABLED=false, hawkBit calls return 400
			expect([400, 503]).toContain(response.status);
		});

		it('GET /actions returns 400 when hawkBit disabled', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices/${deviceId}/actions`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			expect([400, 503]).toContain(response.status);
		});
	});

	describe('Device Claiming', () => {
		it('POST claim with unknown serial returns 404', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({
						name: 'Unknown Device',
						serialNumber: 'DEADBEEF12345678',
					}),
				}),
			);
			expect(response.status).toBe(404);
			const body = await response.json();
			expect(body.error).toBe('Not Found');
			expect(body.message).toContain('Provision it first');
		});

		it('POST claim same serial twice returns 409', async () => {
			// Provision first
			await app.handle(
				new Request('http://localhost/api/devices/provision', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: superAdminCookie },
					body: JSON.stringify({
						serialNumber: `AA00BB11CC${ts.toString(16).toUpperCase().slice(-6).padStart(6, '0')}`,
						deviceKey: 'test-dup-key-12345678',
					}),
				}),
			);
			const dupSerial = `AA00BB11CC${ts.toString(16).toUpperCase().slice(-6).padStart(6, '0')}`;
			// Claim first
			await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ serialNumber: dupSerial }),
				}),
			);
			// Claim again same company
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ serialNumber: dupSerial }),
				}),
			);
			expect(response.status).toBe(409);
		});

		it('POST claim without serialNumber returns 400', async () => {
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
			// Use a fixed valid UUID that won't exist — test is about auth, not device lookup
			const response = await app.handle(
				new Request(
					`http://localhost/api/companies/${companyId}/devices/00000000-0000-0000-0000-000000000099/link`,
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
				new Request(`http://localhost/api/companies/${companyId}/devices/${deviceId}/link`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
				}),
			);
			expect(response.status).toBe(400);
		});

		it('PUT /:deviceId/link with short deviceKey returns 400', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices/${deviceId}/link`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ deviceKey: 'short' }),
				}),
			);
			expect(response.status).toBe(400);
		});
	});

	describe('Serial Number Normalization', () => {
		it('POST claim with hex serial stores hex in serialNumber', async () => {
			const hexSerial = `AABBCCDD${ts.toString(16).toUpperCase().padStart(8, '0')}`;
			// Provision first
			await app.handle(
				new Request('http://localhost/api/devices/provision', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: superAdminCookie },
					body: JSON.stringify({ serialNumber: hexSerial, deviceKey: 'test-hex-key-12345678' }),
				}),
			);
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ serialNumber: hexSerial }),
				}),
			);
			expect(response.status).toBe(201);
			const body = await response.json();
			expect(body.data.serialNumber).toBe(hexSerial.toUpperCase());
			expect(body.data.serialDisplay).toContain('.');
		});

		it('POST claim with dotted serial normalizes to hex', async () => {
			const hexPart = ((ts + 1) & 0xffffffff).toString(16).toUpperCase().padStart(8, '0');
			const dottedSerial = `${hexPart.slice(0, 2)}.${hexPart.slice(2, 4)}.${hexPart.slice(4, 6)}.${hexPart.slice(6, 8)}`;
			// Provision first
			await app.handle(
				new Request('http://localhost/api/devices/provision', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: superAdminCookie },
					body: JSON.stringify({
						serialNumber: dottedSerial,
						deviceKey: 'test-dotted-key-12345678',
					}),
				}),
			);
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ serialNumber: dottedSerial }),
				}),
			);
			expect(response.status).toBe(201);
			const body = await response.json();
			expect(body.data.serialNumber).toBe(hexPart);
		});

		it('POST claim with mixed-case hex normalizes to uppercase', async () => {
			const hexPart = ((ts + 2) & 0xffffffff).toString(16).padStart(8, '0').toLowerCase();
			const mixedSerial = hexPart;
			// Provision first
			await app.handle(
				new Request('http://localhost/api/devices/provision', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: superAdminCookie },
					body: JSON.stringify({ serialNumber: mixedSerial, deviceKey: 'test-mixed-key-12345678' }),
				}),
			);
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ serialNumber: mixedSerial }),
				}),
			);
			expect(response.status).toBe(201);
			const body = await response.json();
			expect(body.data.serialNumber).toBe(hexPart.toUpperCase());
		});
	});
});
