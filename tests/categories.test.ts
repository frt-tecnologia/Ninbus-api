import { afterAll, describe, expect, it } from 'bun:test';
import { db } from '@common/db';
import { devices } from '@common/db/schema';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app';
import { cleanAll } from './test-helpers';

afterAll(async () => {
	await cleanAll();
});

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

	async function getSuperAdminCookie(): Promise<string> {
		// Super admin email is admin-test@ninbus.com.br (per .env.test).
		// Sign-up is idempotent (returns USER_ALREADY_EXISTS if registered).
		await app.handle(
			new Request('http://localhost/api/auth/sign-up/email', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: 'admin-test@ninbus.com.br', password, name: 'Super Admin' }),
			}),
		);
		const signIn = await app.handle(
			new Request('http://localhost/api/auth/sign-in/email', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: 'admin-test@ninbus.com.br', password }),
			}),
		);
		return signIn.headers.get('set-cookie') || '';
	}

	async function createCompany(ownerEmail: string): Promise<string> {
		const superAdminCookie = await getSuperAdminCookie();
		const response = await app.handle(
			new Request('http://localhost/api/companies', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: superAdminCookie },
				body: JSON.stringify({ name: 'Cat Test Company', ownerEmail }),
			}),
		);
		const body = await response.json();
		return body.data.id;
	}

	describe('CRUD', () => {
		it('setup: creates company', async () => {
			ownerCookie = await signUpAndIn(ownerEmail, 'Category Owner');
			companyId = await createCompany(ownerEmail);
			expect(companyId).toBeDefined();
		}, 15000);

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

	// =========================================================================
	// Category members (devices) — N:N management for the Flutter frontend.
	// Covers: adesão de membros, exclusão de membros, edição de membros,
	// listagem de membros dentro do grupo. Testado contra os 3 tipos pré-existentes.
	// =========================================================================
	describe('Category Members (device ↔ category N:N)', () => {
		let memberCompanyId: string;
		let memberCookie: string;
		let lineCat: string;
		let garageCat: string;
		let regionCat: string;
		// Devices inserted directly into the test DB (no hawkBit needed).
		let dev1: string;
		let dev2: string;
		let dev3: string;

		it('setup: signs in, creates company, categories and devices', async () => {
			const email = `member-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
			memberCookie = await signUpAndIn(email, 'Member Owner');
			memberCompanyId = await createCompany(email);

			// Cria os 3 tipos pré-existentes (lines | garages | regions)
			for (const [key, type] of [
				['line', 'bus_line'],
				['garage', 'garage'],
				['region', 'region'],
			] as const) {
				const r = await app.handle(
					new Request(`http://localhost/api/companies/${memberCompanyId}/categories`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json', Cookie: memberCookie },
						body: JSON.stringify({ name: `Grupo ${key}`, type }),
					}),
				);
				expect(r.status).toBe(201);
				const id = (await r.json()).data.id;
				if (type === 'bus_line') lineCat = id;
				if (type === 'garage') garageCat = id;
				if (type === 'region') regionCat = id;
			}

			// Insere dispositivos diretamente (testes rodam com HAWKBIT_ENABLED=false).
			const inserted = await db
				.insert(devices)
				.values([
					{
						companyId: memberCompanyId,
						name: 'Onibus 1',
						serialNumber: 'AABBCCDD001' + '0',
						status: 'accepted',
					},
					{
						companyId: memberCompanyId,
						name: 'Onibus 2',
						serialNumber: 'AABBCCDD001' + '1',
						status: 'accepted',
					},
					{
						companyId: memberCompanyId,
						name: 'Onibus 3',
						serialNumber: 'AABBCCDD001' + '2',
						status: 'accepted',
					},
				])
				.returning({ id: devices.id });
			[dev1, dev2, dev3] = inserted.map((d) => d.id);
			expect(dev1).toBeDefined();
			expect(dev3).toBeDefined();
		}, 20000);

		it('GET /:categoryId/devices retorna vazio para categoria nova', async () => {
			const r = await app.handle(
				new Request(
					`http://localhost/api/companies/${memberCompanyId}/categories/${lineCat}/devices`,
					{ headers: { Cookie: memberCookie } },
				),
			);
			expect(r.status).toBe(200);
			const body = await r.json();
			expect(body.data.length).toBe(0);
			expect(body.total).toBe(0);
		});

		it('POST /:categoryId/devices adiciona membros (adesão)', async () => {
			const r = await app.handle(
				new Request(
					`http://localhost/api/companies/${memberCompanyId}/categories/${lineCat}/devices`,
					{
						method: 'POST',
						headers: { 'Content-Type': 'application/json', Cookie: memberCookie },
						body: JSON.stringify({ deviceIds: [dev1, dev2] }),
					},
				),
			);
			expect(r.status).toBe(200);
			const body = await r.json();
			expect(body.data.assigned).toBe(2);
			expect(body.data.skipped).toBe(0);
			expect(body.data.total).toBe(2);
		});

		it('POST é idempotente — re-adicionar os mesmos pula', async () => {
			const r = await app.handle(
				new Request(
					`http://localhost/api/companies/${memberCompanyId}/categories/${lineCat}/devices`,
					{
						method: 'POST',
						headers: { 'Content-Type': 'application/json', Cookie: memberCookie },
						body: JSON.stringify({ deviceIds: [dev1, dev2, dev3] }),
					},
				),
			);
			expect(r.status).toBe(200);
			const body = await r.json();
			expect(body.data.assigned).toBe(1); // só dev3 era novo
			expect(body.data.skipped).toBe(2);
			expect(body.data.total).toBe(3);
		});

		it('GET /:categoryId/devices retorna todos membros com assignedAt', async () => {
			const r = await app.handle(
				new Request(
					`http://localhost/api/companies/${memberCompanyId}/categories/${lineCat}/devices`,
					{ headers: { Cookie: memberCookie } },
				),
			);
			const body = await r.json();
			expect(body.data.length).toBe(3);
			expect(body.total).toBe(3);
			for (const d of body.data) {
				expect(d.assignedAt).toBeDefined();
				expect(d.id).toBeDefined();
			}
		});

		it('DELETE /:categoryId/devices/:deviceId remove um membro específico', async () => {
			const r = await app.handle(
				new Request(
					`http://localhost/api/companies/${memberCompanyId}/categories/${lineCat}/devices/${dev1}`,
					{ method: 'DELETE', headers: { Cookie: memberCookie } },
				),
			);
			expect(r.status).toBe(200);
			const body = await r.json();
			expect(body.data.removed).toBe(1);

			// Verifica que lista agora tem 2
			const list = await app.handle(
				new Request(
					`http://localhost/api/companies/${memberCompanyId}/categories/${lineCat}/devices`,
					{ headers: { Cookie: memberCookie } },
				),
			);
			expect((await list.json()).total).toBe(2);
		});

		it('DELETE de um não-membro retorna removed=0 (não 404)', async () => {
			const r = await app.handle(
				new Request(
					`http://localhost/api/companies/${memberCompanyId}/categories/${lineCat}/devices/${dev1}`,
					{ method: 'DELETE', headers: { Cookie: memberCookie } },
				),
			);
			expect(r.status).toBe(200);
			const body = await r.json();
			expect(body.data.removed).toBe(0);
		});

		it('PUT /:categoryId/devices substitui TODOS os membros (edição dos membros)', async () => {
			// lineCat tem dev2, dev3 agora. Substituir por [dev1, dev3].
			const r = await app.handle(
				new Request(
					`http://localhost/api/companies/${memberCompanyId}/categories/${lineCat}/devices`,
					{
						method: 'PUT',
						headers: { 'Content-Type': 'application/json', Cookie: memberCookie },
						body: JSON.stringify({ deviceIds: [dev1, dev3] }),
					},
				),
			);
			expect(r.status).toBe(200);
			const body = await r.json();
			expect(body.data.total).toBe(2);

			const list = await app.handle(
				new Request(
					`http://localhost/api/companies/${memberCompanyId}/categories/${lineCat}/devices`,
					{ headers: { Cookie: memberCookie } },
				),
			);
			const listed = (await list.json()).data.map((d: any) => d.id).sort();
			expect(listed).toEqual([dev1, dev3].sort());
		});

		it('PUT com array vazio retorna 400 (minItems:1 — use POST/DELETE)', async () => {
			const r = await app.handle(
				new Request(
					`http://localhost/api/companies/${memberCompanyId}/categories/${regionCat}/devices`,
					{
						method: 'PUT',
						headers: { 'Content-Type': 'application/json', Cookie: memberCookie },
						body: JSON.stringify({ deviceIds: [] }),
					},
				),
			);
			expect(r.status).toBe(400);
		});

		it('GET em categoria inexistente retorna 404', async () => {
			const fake = '00000000-0000-4000-8000-000000000000';
			const r = await app.handle(
				new Request(
					`http://localhost/api/companies/${memberCompanyId}/categories/${fake}/devices`,
					{ headers: { Cookie: memberCookie } },
				),
			);
			expect(r.status).toBe(404);
		});

		it('POST sem deviceIds retorna 400', async () => {
			const r = await app.handle(
				new Request(
					`http://localhost/api/companies/${memberCompanyId}/categories/${garageCat}/devices`,
					{
						method: 'POST',
						headers: { 'Content-Type': 'application/json', Cookie: memberCookie },
						body: JSON.stringify({}),
					},
				),
			);
			expect(r.status).toBe(400);
		});

		it('retorna 403 para usuário de outra empresa', async () => {
			const otherEmail = `member-other-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
			const otherCookie = await signUpAndIn(otherEmail, 'Outro');
			const r = await app.handle(
				new Request(
					`http://localhost/api/companies/${memberCompanyId}/categories/${lineCat}/devices`,
					{ headers: { Cookie: otherCookie } },
				),
			);
			expect(r.status).toBe(403);
		});

		it('retorna 401 sem auth', async () => {
			const r = await app.handle(
				new Request(
					`http://localhost/api/companies/${memberCompanyId}/categories/${lineCat}/devices`,
				),
			);
			expect(r.status).toBe(401);
		});

		it('NÃO vaza dispositivos cross-tenant (só adiciona mesma empresa)', async () => {
			// Cria 2ª empresa + dispositivo pertencente a ela.
			const emailB = `cross-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
			const compB = await createCompany(emailB);
			const [foreignDev] = await db
				.insert(devices)
				.values({
					companyId: compB,
					name: 'Foreign',
					serialNumber: 'AABBCCDD0099',
					status: 'accepted',
				})
				.returning({ id: devices.id });

			// Tenta adicionar dispositivo estrangeiro à categoria de memberCompanyId.
			const r = await app.handle(
				new Request(
					`http://localhost/api/companies/${memberCompanyId}/categories/${garageCat}/devices`,
					{
						method: 'POST',
						headers: { 'Content-Type': 'application/json', Cookie: memberCookie },
						body: JSON.stringify({ deviceIds: [foreignDev.id, dev2] }),
					},
				),
			);
			expect(r.status).toBe(200);
			const body = await r.json();
			expect(body.data.assigned).toBe(1); // só dev2 (mesma empresa)

			// Dispositivo estrangeiro NÃO está na categoria.
			const list = await app.handle(
				new Request(
					`http://localhost/api/companies/${memberCompanyId}/categories/${garageCat}/devices`,
					{ headers: { Cookie: memberCookie } },
				),
			);
			const ids = (await list.json()).data.map((d: any) => d.id);
			expect(ids).not.toContain(foreignDev.id);
		}, 15000);

		it('DELETE de categoria inteira (exclusão do grupo) faz cascade dos membros', async () => {
			// garageCat tem dev2 como membro agora.
			const r = await app.handle(
				new Request(`http://localhost/api/companies/${memberCompanyId}/categories/${garageCat}`, {
					method: 'DELETE',
					headers: { Cookie: memberCookie },
				}),
			);
			expect(r.status).toBe(200);
			// O dispositivo em si permanece (onDelete: cascade só remove a atribuição).
			const stillHere = await db.select().from(devices).where(eq(devices.id, dev2));
			expect(stillHere.length).toBe(1);
		});
	});
});
