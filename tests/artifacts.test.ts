import { afterAll, describe, expect, it } from 'bun:test';
import { createApp } from '../src/app';
import { db } from '../src/common/db';
import { artifacts, categories } from '../src/common/db/schema';
import { cleanAll } from './test-helpers';

afterAll(async () => {
	await cleanAll();
});

describe('Artifacts Module', () => {
	const app = createApp();
	const ownerEmail = `art-owner-${Date.now()}@example.com`;
	const otherEmail = `art-other-${Date.now()}@example.com`;
	const superAdminEmail = 'admin-test@ninbus.com.br';
	const password = 'TestPassword123!';
	let ownerCookie: string;
	let otherCookie: string;
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

	async function setupCompany(ownerEmail: string): Promise<string> {
		// Company creation requires super admin (see companies/index.ts POST → superAdmin: true).
		const response = await app.handle(
			new Request('http://localhost/api/companies', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: superAdminCookie },
				body: JSON.stringify({ name: 'Artifact Test Company', ownerEmail }),
			}),
		);
		return (await response.json()).data.id;
	}

	describe('Setup', () => {
		it('creates company', async () => {
			superAdminCookie = await signUpAndIn(superAdminEmail, 'Super Admin');
			ownerCookie = await signUpAndIn(ownerEmail, 'Artifact Owner');
			otherCookie = await signUpAndIn(otherEmail, 'Other User');
			companyId = await setupCompany(ownerEmail);
			expect(companyId).toBeDefined();
		}, 10000);
	});

	describe('Artifact Types', () => {
		it('GET /types returns 3 types', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/types`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.data.length).toBe(3);
		});

		it('firmware-ninbus has risk HIGH and reboot YES', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/types`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			const body = await response.json();
			const fwType = body.data.find((t: any) => t.type === 'firmware-ninbus');
			expect(fwType).toBeDefined();
			expect(fwType.riskLevel).toBe('high');
			expect(fwType.requiresReboot).toBe(true);
		});

		it('firmware-controller has risk MEDIUM and reboot NO', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/types`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			const body = await response.json();
			const ctrlType = body.data.find((t: any) => t.type === 'firmware-controller');
			expect(ctrlType).toBeDefined();
			expect(ctrlType.riskLevel).toBe('medium');
			expect(ctrlType.requiresReboot).toBe(false);
		});

		it('configuration-nfx has risk LOW and reboot NO', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/types`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			const body = await response.json();
			const nfxType = body.data.find((t: any) => t.type === 'configuration-nfx');
			expect(nfxType).toBeDefined();
			expect(nfxType.riskLevel).toBe('low');
			expect(nfxType.requiresReboot).toBe(false);
		});

		it('returns 403 for non-member', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/types`, {
					headers: { Cookie: otherCookie },
				}),
			);
			expect(response.status).toBe(403);
		});
	});

	describe('Upload Validation', () => {
		it('POST without file returns 400', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({
						artifactName: 'test-firmware',
						artifactType: 'firmware-ninbus',
					}),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('POST without artifactName returns 400', async () => {
			const formData = new FormData();
			formData.append('file', new File([new Uint8Array([1, 2, 3])], 'test.fir'));

			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts`, {
					method: 'POST',
					headers: { Cookie: ownerCookie },
					body: formData,
				}),
			);
			expect(response.status).toBe(400);
		});

		it('POST without artifactType returns 400', async () => {
			const formData = new FormData();
			formData.append('file', new File([new Uint8Array([1, 2, 3])], 'test.fir'));
			formData.append('artifactName', 'test-firmware');

			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts`, {
					method: 'POST',
					headers: { Cookie: ownerCookie },
					body: formData,
				}),
			);
			expect(response.status).toBe(400);
		});

		it('POST with invalid artifactType returns 400', async () => {
			const formData = new FormData();
			formData.append('file', new File([new Uint8Array([1, 2, 3])], 'test.fir'));
			formData.append('artifactName', 'test-firmware');
			formData.append('artifactType', 'invalid-type');

			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts`, {
					method: 'POST',
					headers: { Cookie: ownerCookie },
					body: formData,
				}),
			);
			expect(response.status).toBe(400);
		});

		it('POST without auth returns 401', async () => {
			const formData = new FormData();
			formData.append('file', new File([new Uint8Array([1, 2, 3])], 'test.fir'));
			formData.append('artifactName', 'test-firmware');
			formData.append('artifactType', 'firmware-ninbus');

			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts`, {
					method: 'POST',
					body: formData,
				}),
			);
			expect(response.status).toBe(401);
		});

		it('POST non-member returns 403', async () => {
			const formData = new FormData();
			formData.append('file', new File([new Uint8Array([1, 2, 3])], 'test.fir'));
			formData.append('artifactName', 'test-firmware');
			formData.append('artifactType', 'firmware-ninbus');

			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts`, {
					method: 'POST',
					headers: { Cookie: otherCookie },
					body: formData,
				}),
			);
			expect(response.status).toBe(403);
		});
	});

	describe('Auth & Authorization', () => {
		it('GET / returns 403 for non-member', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts`, {
					headers: { Cookie: otherCookie },
				}),
			);
			expect(response.status).toBe(403);
		});

		it('GET / returns 401 without auth', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts`),
			);
			expect(response.status).toBe(401);
		});

		it('GET /:id returns 401 without auth', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/1`),
			);
			expect(response.status).toBe(401);
		});

		it('DELETE /:id returns 401 without auth', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/1`, {
					method: 'DELETE',
				}),
			);
			expect(response.status).toBe(401);
		});

		it('PUT /:id returns 401 without auth', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/1`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ description: 'test' }),
				}),
			);
			expect(response.status).toBe(401);
		});
	});

	describe('Artifact Update Validation', () => {
		it('PUT with empty description returns 400', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/1`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ description: '' }),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('PUT with description >1000 chars returns 400', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/1`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ description: 'x'.repeat(1001) }),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('PUT without body returns 400', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/1`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
				}),
			);
			expect(response.status).toBe(400);
		});
	});

	describe('Artifact PATCH (metadata edit)', () => {
		const seedSmId = 777001;

		// Seed a local artifact row so requireOwnership passes; with hawkBit
		// disabled in tests, requireHawkbit() then surfaces a clean 400 —
		// validating the two-level guard (ownership first, hawkBit guard second).
		it('setup: seeds a local artifact record', async () => {
			await db
				.insert(artifacts)
				.values({
					companyId,
					hawkbitSmId: seedSmId,
					name: 'Seed Artifact',
					artifactType: 'firmware-controller',
					version: '1.0',
					description: 'original',
				})
				.onConflictDoNothing();
			expect(true).toBe(true);
		});

		it('PATCH returns 400 when name is empty', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/${seedSmId}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ name: '' }),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('PATCH returns 400 when name exceeds 256 chars', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/${seedSmId}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ name: 'x'.repeat(257) }),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('PATCH returns 404 for artifact not owned by this company', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/99998`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ description: 'x' }),
				}),
			);
			expect(response.status).toBe(404);
		});

		it('PATCH returns 403 for non-member', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/${seedSmId}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json', Cookie: otherCookie },
					body: JSON.stringify({ description: 'x' }),
				}),
			);
			expect(response.status).toBe(403);
		});

		it('PATCH on owned artifact returns 400 when hawkBit is disabled (two-level guard)', async () => {
			// Ownership passes (seeded row), then requireHawkbit() throws → 400.
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/${seedSmId}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ name: 'Renamed', description: 'updated' }),
				}),
			);
			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.message).toContain('hawkBit');
		});
	});

	describe('Tenant Isolation', () => {
		let otherCompanyId: string;

		it('setup: creates second company', async () => {
			otherCompanyId = await setupCompany(otherEmail);
			expect(otherCompanyId).toBeDefined();
		});

		it('GET / returns empty list for company with no artifacts', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${otherCompanyId}/artifacts`, {
					headers: { Cookie: otherCookie },
				}),
			);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.data).toEqual([]);
			expect(body.total).toBe(0);
		});

		it('GET /:id returns 404 for artifact from another company (not registered locally)', async () => {
			// Artifact #1 doesn't exist in local DB for otherCompany → 404
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${otherCompanyId}/artifacts/99999`, {
					headers: { Cookie: otherCookie },
				}),
			);
			expect(response.status).toBe(404);
		});

		it('DELETE /:id returns 404 for artifact from another company', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${otherCompanyId}/artifacts/99999`, {
					method: 'DELETE',
					headers: { Cookie: otherCookie },
				}),
			);
			expect(response.status).toBe(404);
		});

		it('PUT /:id returns 404 for artifact from another company', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${otherCompanyId}/artifacts/99999`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json', Cookie: otherCookie },
					body: JSON.stringify({ description: 'hacked!' }),
				}),
			);
			expect(response.status).toBe(404);
		});

		it('GET /:id/download returns 404 for artifact from another company', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${otherCompanyId}/artifacts/99999/download`, {
					headers: { Cookie: otherCookie },
				}),
			);
			expect(response.status).toBe(404);
		});
	});

	describe('Artifact Categories (grouping)', () => {
		const catSmId = 778001;
		let catA: string;
		let catB: string;
		let otherCompanyId2: string;
		let crossTenantCatId: string;

		async function createCategory(compId: string, cookie: string, name: string): Promise<string> {
			const r = await app.handle(
				new Request(`http://localhost/api/companies/${compId}/categories`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: cookie },
					body: JSON.stringify({ name, type: 'custom' }),
				}),
			);
			return (await r.json()).data.id;
		}

		it('setup: seeds artifact + categories', async () => {
			await db
				.insert(artifacts)
				.values({
					companyId,
					hawkbitSmId: catSmId,
					name: 'Grouped Artifact',
					artifactType: 'firmware-controller',
					version: '1.0',
				})
				.onConflictDoNothing();
			catA = await createCategory(companyId, ownerCookie, 'Grupo Firmware A');
			catB = await createCategory(companyId, ownerCookie, 'Grupo Firmware B');
			// Second company + a category in it (for cross-tenant test)
			otherCompanyId2 = await setupCompany(`art-cross-${Date.now()}@example.com`);
			const [cross] = await db
				.insert(categories)
				.values({ companyId: otherCompanyId2, name: 'Cross Tenant', type: 'custom' })
				.returning();
			crossTenantCatId = cross!.id;
			expect(catA).toBeDefined();
			expect(crossTenantCatId).toBeDefined();
		}, 15000);

		// ── HAPPY PATHS ──────────────────────────────────────────────
		it('PATCH assigns groups → 200 with counts', async () => {
			const r = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/${catSmId}/categories`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ categoryIds: [catA, catB] }),
				}),
			);
			expect(r.status).toBe(200);
			const body = await r.json();
			expect(body.assigned).toBe(2);
			expect(body.dropped).toBe(0);
		});

		it('GET lists assigned groups', async () => {
			const r = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/${catSmId}/categories`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			expect(r.status).toBe(200);
			const body = await r.json();
			expect(body.total).toBe(2);
			expect(body.data.map((c: any) => c.name).sort()).toEqual(['Grupo Firmware A', 'Grupo Firmware B']);
		});

		it('PATCH replaces the set (idempotent)', async () => {
			const r = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/${catSmId}/categories`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ categoryIds: [catA] }),
				}),
			);
			expect(r.status).toBe(200);
			const get = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/${catSmId}/categories`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			expect((await get.json()).total).toBe(1);
		});

		it('PATCH with [] clears all groups', async () => {
			const r = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/${catSmId}/categories`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ categoryIds: [] }),
				}),
			);
			expect(r.status).toBe(200);
			const get = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/${catSmId}/categories`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			expect((await get.json()).total).toBe(0);
		});

		it('DELETE removes a single group', async () => {
			await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/${catSmId}/categories`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ categoryIds: [catA, catB] }),
				}),
			);
			const r = await app.handle(
				new Request(
					`http://localhost/api/companies/${companyId}/artifacts/${catSmId}/categories/${catA}`,
					{ method: 'DELETE', headers: { Cookie: ownerCookie } },
				),
			);
			expect(r.status).toBe(200);
			const get = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/${catSmId}/categories`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			expect((await get.json()).total).toBe(1);
		});

		// ── SAD PATHS (input validation) ────────────────────────────
		it('PATCH with malformed (non-uuid) categoryId → 400', async () => {
			const r = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/${catSmId}/categories`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ categoryIds: ['not-a-uuid'] }),
				}),
			);
			expect(r.status).toBe(400);
		});

		it('PATCH with categoryIds not an array → 400', async () => {
			const r = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/${catSmId}/categories`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ categoryIds: 'should-be-array' }),
				}),
			);
			expect(r.status).toBe(400);
		});

		it('PATCH missing categoryIds field → 400', async () => {
			const r = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/${catSmId}/categories`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({}),
				}),
			);
			expect(r.status).toBe(400);
		});

		it('PATCH malformed JSON body → 400', async () => {
			const r = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/${catSmId}/categories`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: '{invalid json',
				}),
			);
			expect(r.status).toBe(400);
		});

		it('PATCH with >200 categoryIds → 400', async () => {
			const many = Array.from({ length: 201 }, () => '00000000-0000-0000-0000-000000000000');
			const r = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/${catSmId}/categories`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ categoryIds: many }),
				}),
			);
			expect(r.status).toBe(400);
		});

		// ── SAD PATHS (auth/ownership/tenant) ───────────────────────
		it('PATCH artifact not owned by this company → 404', async () => {
			// catSmId belongs to companyId; 778998 has no local row → 404 (ownerCookie IS a member here).
			const r = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/778998/categories`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ categoryIds: [] }),
				}),
			);
			expect(r.status).toBe(404);
		});

		it('PATCH non-member → 403', async () => {
			const r = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/${catSmId}/categories`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json', Cookie: otherCookie },
					body: JSON.stringify({ categoryIds: [] }),
				}),
			);
			expect(r.status).toBe(403);
		});

		it('PATCH without auth → 401', async () => {
			const r = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/${catSmId}/categories`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ categoryIds: [] }),
				}),
			);
			expect(r.status).toBe(401);
		});

		it('GET artifact not owned → 404', async () => {
			const r = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/778998/categories`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			expect(r.status).toBe(404);
		});

		// ── CROSS-TENANT SAFETY ─────────────────────────────────────
		it('PATCH silently drops cross-tenant categoryIds (not assigned)', async () => {
			const r = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/${catSmId}/categories`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					// catA is valid; crossTenantCatId belongs to otherCompanyId2 → must be dropped
					body: JSON.stringify({ categoryIds: [catA, crossTenantCatId] }),
				}),
			);
			expect(r.status).toBe(200);
			const body = await r.json();
			expect(body.assigned).toBe(1);
			expect(body.dropped).toBe(1);
			const get = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/${catSmId}/categories`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			const list = await get.json();
			expect(list.total).toBe(1);
			expect(list.data.some((c: any) => c.id === crossTenantCatId)).toBe(false);
		});
	});
});
