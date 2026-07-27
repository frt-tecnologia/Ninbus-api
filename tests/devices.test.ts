import { afterAll, describe, expect, it } from 'bun:test';
import { createApp } from '../src/app';
import { db } from '../src/common/db';
import { companies, deviceConnections } from '../src/common/db/schema';
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

		describe('Device PATCH (metadata edit)', () => {
			it('GET device response includes the description field (nullable)', async () => {
				const response = await app.handle(
					new Request(`http://localhost/api/companies/${companyId}/devices/${deviceId}`, {
						headers: { Cookie: ownerCookie },
					}),
				);
				expect(response.status).toBe(200);
				const body = await response.json();
				expect(body.data).toHaveProperty('description');
				expect(body.data.description).toBeNull(); // never set yet
			});

			it('PATCH updates name and description, returns updated device', async () => {
				const response = await app.handle(
					new Request(`http://localhost/api/companies/${companyId}/devices/${deviceId}`, {
						method: 'PATCH',
						headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
						body: JSON.stringify({ name: 'Ônibus Central 01', description: 'Ativo na linha central' }),
					}),
				);
				expect(response.status).toBe(200);
				const body = await response.json();
				expect(body.data.name).toBe('Ônibus Central 01');
				expect(body.data.description).toBe('Ativo na linha central');
			});

			it('PATCH only changes provided fields (partial)', async () => {
				const response = await app.handle(
					new Request(`http://localhost/api/companies/${companyId}/devices/${deviceId}`, {
						method: 'PATCH',
						headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
						body: JSON.stringify({ description: 'Nova descrição only' }),
					}),
				);
				expect(response.status).toBe(200);
				const body = await response.json();
				expect(body.data.name).toBe('Ônibus Central 01'); // unchanged
				expect(body.data.description).toBe('Nova descrição only');
			});

			it('PATCH clears description with empty string (→ null)', async () => {
				const response = await app.handle(
					new Request(`http://localhost/api/companies/${companyId}/devices/${deviceId}`, {
						method: 'PATCH',
						headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
						body: JSON.stringify({ description: '' }),
					}),
				);
				expect(response.status).toBe(200);
				expect((await response.json()).data.description).toBeNull();
			});

			it('PATCH returns 400 when name is empty', async () => {
				const response = await app.handle(
					new Request(`http://localhost/api/companies/${companyId}/devices/${deviceId}`, {
						method: 'PATCH',
						headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
						body: JSON.stringify({ name: '' }),
					}),
				);
				expect(response.status).toBe(400);
			});

			it('PATCH returns 404 for non-existent device', async () => {
				const fakeId = '00000000-0000-0000-0000-000000000000';
				const response = await app.handle(
					new Request(`http://localhost/api/companies/${companyId}/devices/${fakeId}`, {
						method: 'PATCH',
						headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
						body: JSON.stringify({ description: 'x' }),
					}),
				);
				expect(response.status).toBe(404);
			});

			it('PATCH returns 403 for non-member', async () => {
				const response = await app.handle(
					new Request(`http://localhost/api/companies/${companyId}/devices/${deviceId}`, {
						method: 'PATCH',
						headers: { 'Content-Type': 'application/json', Cookie: otherCookie },
						body: JSON.stringify({ description: 'x' }),
					}),
				);
				expect(response.status).toBe(403);
			});
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

	describe('Device Connections Timeline', () => {
		const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
		let connDeviceId: string;

		// Seed raw transition events: online@-3h, offline@-2h, online@-1h (within 24h)
		it('setup: seeds connection events', async () => {
			connDeviceId = deviceId; // the claimed device from CRUD setup
			const rows = [-3 * 3600_000, -2 * 3600_000, -1 * 3600_000].map((ms) => ({
				deviceId: connDeviceId,
				companyId,
				hawkbitTargetId: null,
				deviceName: 'Conn Device',
				event: ms === -2 * 3600_000 ? ('offline' as const) : ('online' as const),
				occurredAt: new Date(Date.now() + ms),
			}));
			await db.insert(deviceConnections).values(rows);
			expect(true).toBe(true);
		});

		it('GET /connections (default 24h) returns the events oldest-first', async () => {
			const r = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices/connections`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			expect(r.status).toBe(200);
			const body = await r.json();
			expect(body.total).toBe(3);
			expect(body.data.map((e: any) => e.event)).toEqual(['online', 'offline', 'online']);
			expect(body.data[0].deviceId).toBe(connDeviceId);
			expect(body.range).toHaveProperty('from');
			expect(body.range).toHaveProperty('to');
		});

		it('GET /connections with explicit from/to filters the window', async () => {
			const from = iso(-150 * 60 * 1000); // -2.5h
			const to = iso(0); // now
			const r = await app.handle(
				new Request(
					`http://localhost/api/companies/${companyId}/devices/connections?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
					{ headers: { Cookie: ownerCookie } },
				),
			);
			expect(r.status).toBe(200);
			const body = await r.json();
			expect(body.total).toBe(2); // offline@-2h, online@-1h
			expect(body.range.from).toBe(from);
			expect(body.range.to).toBe(to);
		});

		it('GET /connections with deviceId filters a single device', async () => {
			const r = await app.handle(
				new Request(
					`http://localhost/api/companies/${companyId}/devices/connections?deviceId=${connDeviceId}`,
					{ headers: { Cookie: ownerCookie } },
				),
			);
			expect(r.status).toBe(200);
			expect((await r.json()).total).toBe(3);
		});

		it('GET /connections excludes events from another company (tenant isolation)', async () => {
			// Insert an event for a DIFFERENT (real) company in the same window — must NOT appear.
			const [other] = await db.insert(companies).values({ name: 'Other Co' }).returning({ id: companies.id });
			await db.insert(deviceConnections).values({
				deviceId: connDeviceId,
				companyId: other!.id,
				event: 'online',
				occurredAt: new Date(),
			});
			const r = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices/connections`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			const body = await r.json();
			// still 3 (the other-company row is filtered out by companyId)
			expect(body.total).toBe(3);
		});

		it('GET /connections from>to → 400', async () => {
			const r = await app.handle(
				new Request(
					`http://localhost/api/companies/${companyId}/devices/connections?from=${encodeURIComponent(iso(0))}&to=${encodeURIComponent(iso(-3600_000))}`,
					{ headers: { Cookie: ownerCookie } },
				),
			);
			expect(r.status).toBe(400);
		});

		it('GET /connections range > retention → 400', async () => {
			const from = iso(-100 * 24 * 3600_000); // 100 days ago (> 90 default)
			const to = iso(0);
			const r = await app.handle(
				new Request(
					`http://localhost/api/companies/${companyId}/devices/connections?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
					{ headers: { Cookie: ownerCookie } },
				),
			);
			expect(r.status).toBe(400);
		});

		it('GET /connections malformed from → 400', async () => {
			const r = await app.handle(
				new Request(
					`http://localhost/api/companies/${companyId}/devices/connections?from=not-a-date`,
					{ headers: { Cookie: ownerCookie } },
				),
			);
			expect(r.status).toBe(400);
		});

		it('GET /connections non-member → 403', async () => {
			const r = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices/connections`, {
					headers: { Cookie: otherCookie },
				}),
			);
			expect(r.status).toBe(403);
		});

		it('GET /connections without auth → 401', async () => {
			const r = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/devices/connections`),
			);
			expect(r.status).toBe(401);
		});
	});
});
