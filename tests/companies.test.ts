import { afterAll, describe, expect, it } from 'bun:test';
import { createApp } from '../src/app';
import { cleanAll } from './test-helpers';

afterAll(async () => {
	await cleanAll();
});

describe('Companies Module', () => {
	const app = createApp();
	const superAdminEmail = 'admin-test@ninbus.com.br';
	const ownerEmail = `company-owner-${Date.now()}@example.com`;
	const pendingOwnerEmail = `pending-owner-${Date.now()}@example.com`;
	const memberEmail = `company-member-${Date.now()}@example.com`;
	const password = 'TestPassword123!';
	let superAdminCookie: string;
	let ownerCookie: string;
	let memberCookie: string;
	let companyId: string;
	let pendingCompanyId: string;

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
					body: JSON.stringify({ name: 'Test Co', ownerEmail }),
				}),
			);
			expect(response.status).toBe(401);
		});
	});

	describe('Factory Onboarding (FASE 1+2)', () => {
		it('setup: signs in super admin (factory)', async () => {
			superAdminCookie = await signUpAndIn(superAdminEmail, 'Super Admin');
			expect(superAdminCookie).toBeTruthy();
		});

		it('regular user CANNOT create company (403)', async () => {
			const regularCookie = await signUpAndIn(`regular-${Date.now()}@example.com`, 'Regular');
			const response = await app.handle(
				new Request('http://localhost/api/companies', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: regularCookie },
					body: JSON.stringify({ name: 'Unauthorized Co', ownerEmail }),
				}),
			);
			expect(response.status).toBe(403);
		});

		it('super admin creates company with existing owner (granted immediately)', async () => {
			// Pre-register the owner
			ownerCookie = await signUpAndIn(ownerEmail, 'Company Owner');

			const response = await app.handle(
				new Request('http://localhost/api/companies', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: superAdminCookie },
					body: JSON.stringify({ name: 'Ninbus Transit', ownerEmail }),
				}),
			);
			expect(response.status).toBe(201);
			const body = await response.json();
			expect(body.data.name).toBe('Ninbus Transit');
			companyId = body.data.id;
		});

		it('owner sees the company in their list (role=owner)', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/companies', {
					headers: { Cookie: ownerCookie },
				}),
			);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.data.some((c: any) => c.id === companyId)).toBe(true);
			const owned = body.data.find((c: any) => c.id === companyId);
			expect(owned.role).toBe('owner');
		});

		it('super admin creates company with NON-existing owner (pending designation)', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/companies', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: superAdminCookie },
					body: JSON.stringify({ name: 'Pending Co', ownerEmail: pendingOwnerEmail }),
				}),
			);
			expect(response.status).toBe(201);
			pendingCompanyId = (await response.json()).data.id;
		});

		it('pending owner does NOT see company before sign-up', async () => {
			// pendingOwnerEmail hasn't signed up yet
			const otherCookie = await signUpAndIn(`other-${Date.now()}@example.com`, 'Other');
			const response = await app.handle(
				new Request('http://localhost/api/companies', {
					headers: { Cookie: otherCookie },
				}),
			);
			const body = await response.json();
			expect(body.data.some((c: any) => c.id === pendingCompanyId)).toBe(false);
		});

		it('pending owner signs up and AUTOMATICALLY gets the company (auto-vinculação)', async () => {
			const newOwnerCookie = await signUpAndIn(pendingOwnerEmail, 'Pending Owner');

			const response = await app.handle(
				new Request('http://localhost/api/companies', {
					headers: { Cookie: newOwnerCookie },
				}),
			);
			expect(response.status).toBe(200);
			const body = await response.json();
			const owned = body.data.find((c: any) => c.id === pendingCompanyId);
			expect(owned).toBeDefined();
			expect(owned.role).toBe('owner');
		});

		it('super admin creates company without ownerEmail → 400', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/companies', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: superAdminCookie },
					body: JSON.stringify({ name: 'No Owner Co' }),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('super admin creates company with invalid email → 400', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/companies', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: superAdminCookie },
					body: JSON.stringify({ name: 'Bad Email Co', ownerEmail: 'not-an-email' }),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('super admin creates company with empty name → 400', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/companies', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: superAdminCookie },
					body: JSON.stringify({ name: '', ownerEmail: `x-${Date.now()}@example.com` }),
				}),
			);
			expect(response.status).toBe(400);
		});
	});

	describe('CRUD (owner perspective)', () => {
		it('GET /:companyId returns company', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			expect(response.status).toBe(200);
		});

		it('PUT /:companyId updates company name', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ name: 'Ninbus Transit Updated' }),
				}),
			);
			expect(response.status).toBe(200);
			expect((await response.json()).data.name).toBe('Ninbus Transit Updated');
		});

		it('GET /:companyId returns 403 for non-member', async () => {
			memberCookie = await signUpAndIn(memberEmail, 'Non Member');
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}`, {
					headers: { Cookie: memberCookie },
				}),
			);
			expect(response.status).toBe(403);
		});
	});

	describe('Members (email-based designation)', () => {
		it('GET lists members (owner present)', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/members`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.data.some((m: any) => m.role === 'owner')).toBe(true);
		});

		it('POST adds existing user by email (granted)', async () => {
			const newMemberEmail = `added-${Date.now()}@example.com`;
			await signUpAndIn(newMemberEmail, 'Added Member');

			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/members`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ email: newMemberEmail, role: 'operator' }),
				}),
			);
			expect(response.status).toBe(201);
			const body = await response.json();
			expect(body.data.granted).toBe(true);
		});

		it('POST creates pending for non-existing email', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/members`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ email: `future-${Date.now()}@example.com`, role: 'viewer' }),
				}),
			);
			expect(response.status).toBe(201);
			const body = await response.json();
			expect(body.data.pending).toBe(true);
		});

		it('POST rejects invalid email → 400', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/members`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ email: 'bad-email', role: 'viewer' }),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('non-member gets 403 on members list', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/members`, {
					headers: { Cookie: memberCookie },
				}),
			);
			expect(response.status).toBe(403);
		});
	});

	describe('Designations (pending member management)', () => {
		it('GET lists pending designations', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/designations`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.data.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe('Owner protection (FASE 4)', () => {
		it('cannot remove the last owner (409)', async () => {
			// Find owner userId
			const membersResp = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/members`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			const members = (await membersResp.json()).data;
			const owner = members.find((m: any) => m.role === 'owner');

			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/members/${owner.userId}`, {
					method: 'DELETE',
					headers: { Cookie: ownerCookie },
				}),
			);
			expect(response.status).toBe(409);
		});
	});

	describe('Validation', () => {
		it('GET /:companyId returns 400 for invalid UUID', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/companies/not-a-uuid', {
					headers: { Cookie: ownerCookie },
				}),
			);
			expect(response.status).toBe(400);
		});
	});
});
