import { describe, expect, it } from 'bun:test';
import { createApp } from '../src/app';

/**
 * Deployment & Artifact tests.
 *
 * These tests verify the Ninbus API layer:
 * 1. Authentication and authorization work
 * 2. Body validation works (including artifactType enum)
 * 3. Ninbus artifact type enrichment works
 * 4. Error handling for Mender unavailability works
 */
describe('Deployments Module', () => {
	const app = createApp();
	const ownerEmail = `deploy-owner-${Date.now()}@example.com`;
	const otherEmail = `deploy-other-${Date.now()}@example.com`;
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

	describe('Setup', () => {
		it('creates users and company', async () => {
			ownerCookie = await signUpAndIn(ownerEmail, 'Deploy Owner');
			otherCookie = await signUpAndIn(otherEmail, 'Deploy Other');

			const response = await app.handle(
				new Request('http://localhost/api/companies', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ name: 'Deploy Test Co' }),
				}),
			);
			companyId = (await response.json()).data.id;
		});
	});

	describe('Artifact Types Endpoint', () => {
		it('GET /deployments/artifact-types returns all 3 types', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/deployments/artifact-types`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.data).toHaveLength(3);

			const types = body.data.map((t: any) => t.type);
			expect(types).toContain('firmware-ninbus');
			expect(types).toContain('firmware-controller');
			expect(types).toContain('configuration-nfx');
		});

		it('returns risk levels for each type', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/deployments/artifact-types`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			const body = await response.json();

			const fw = body.data.find((t: any) => t.type === 'firmware-ninbus');
			expect(fw.riskLevel).toBe('high');
			expect(fw.requiresReboot).toBe(true);
			expect(fw.target).toBeDefined();

			const ctrl = body.data.find((t: any) => t.type === 'firmware-controller');
			expect(ctrl.riskLevel).toBe('medium');
			expect(ctrl.requiresReboot).toBe(false);

			const nfx = body.data.find((t: any) => t.type === 'configuration-nfx');
			expect(nfx.riskLevel).toBe('low');
			expect(nfx.requiresReboot).toBe(false);
		});

		it('returns 403 for non-member', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/deployments/artifact-types`, {
					headers: { Cookie: otherCookie },
				}),
			);
			expect(response.status).toBe(403);
		});

		it('returns 401 without auth', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/deployments/artifact-types`),
			);
			expect(response.status).toBe(401);
		});
	});

	describe('Authentication & Authorization', () => {
		it('POST /deployments returns 401 without auth', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/deployments`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						name: 'test',
						artifactName: 'test',
						artifactType: 'firmware-ninbus',
						allDevices: true,
					}),
				}),
			);
			expect(response.status).toBe(401);
		});

		it('POST /deployments returns 403 for non-member', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/deployments`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: otherCookie },
					body: JSON.stringify({
						name: 'test',
						artifactName: 'test',
						artifactType: 'firmware-ninbus',
						allDevices: true,
					}),
				}),
			);
			expect(response.status).toBe(403);
		});
	});

	describe('Validation — artifactType', () => {
		it('returns 400 for missing artifactType', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/deployments`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({
						name: 'test-deploy',
						artifactName: 'test-artifact',
						allDevices: true,
					}),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('returns 400 for invalid artifactType', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/deployments`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({
						name: 'test-deploy',
						artifactName: 'test-artifact',
						artifactType: 'invalid-type',
						allDevices: true,
					}),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('returns 400 for empty name', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/deployments`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({
						name: '',
						artifactName: 'test',
						artifactType: 'firmware-ninbus',
						allDevices: true,
					}),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('returns 400 for missing artifactName', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/deployments`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({
						name: 'test',
						artifactType: 'firmware-ninbus',
						allDevices: true,
					}),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('returns 400 when no target specified', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/deployments`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({
						name: 'test-deploy',
						artifactName: 'test-artifact',
						artifactType: 'firmware-ninbus',
					}),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('accepts firmware-ninbus artifact type', async () => {
			// Will fail because no Mender devices, but validates schema
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/deployments`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({
						name: 'test-deploy',
						artifactName: 'ninbus-firmware-3.3.0',
						artifactType: 'firmware-ninbus',
						allDevices: true,
					}),
				}),
			);
			// Should be 422 (no eligible devices) not 400 (validation)
			expect([422, 500].includes(response.status)).toBe(true);
		});

		it('accepts firmware-controller artifact type', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/deployments`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({
						name: 'test-deploy',
						artifactName: 'controller-firmware-12.6.0',
						artifactType: 'firmware-controller',
						allDevices: true,
					}),
				}),
			);
			expect([422, 500].includes(response.status)).toBe(true);
		});

		it('accepts configuration-nfx artifact type', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/deployments`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({
						name: 'test-deploy',
						artifactName: 'config-nfx-2026-04-14',
						artifactType: 'configuration-nfx',
						allDevices: true,
					}),
				}),
			);
			expect([422, 500].includes(response.status)).toBe(true);
		});
	});

	describe('GET endpoints', () => {
		it('GET /deployments/:id returns 401 without auth', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/deployments/fake-id`),
			);
			expect(response.status).toBe(401);
		});

		it('GET /deployments/:id returns 403 for non-member', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/deployments/fake-id`, {
					headers: { Cookie: otherCookie },
				}),
			);
			expect(response.status).toBe(403);
		});

		it('GET /deployments/:id/statistics returns 403 for non-member', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/deployments/fake-id/statistics`, {
					headers: { Cookie: otherCookie },
				}),
			);
			expect(response.status).toBe(403);
		});
	});
});

describe('Artifacts Module', () => {
	const app = createApp();
	const ownerEmail = `artifact-owner-${Date.now()}@example.com`;
	const otherEmail = `artifact-other-${Date.now()}@example.com`;
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

	describe('Setup', () => {
		it('creates users and company', async () => {
			ownerCookie = await signUpAndIn(ownerEmail, 'Artifact Owner');
			otherCookie = await signUpAndIn(otherEmail, 'Artifact Other');

			const response = await app.handle(
				new Request('http://localhost/api/companies', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ name: 'Artifact Test Co' }),
				}),
			);
			companyId = (await response.json()).data.id;
		});
	});

	describe('Artifact Types Endpoint', () => {
		it('GET /artifacts/types returns all 3 Ninbus types', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/types`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.data).toHaveLength(3);

			const types = body.data.map((t: any) => t.type);
			expect(types).toContain('firmware-ninbus');
			expect(types).toContain('firmware-controller');
			expect(types).toContain('configuration-nfx');
		});

		it('each type has required metadata fields', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/types`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			const body = await response.json();
			for (const t of body.data) {
				expect(t).toHaveProperty('type');
				expect(t).toHaveProperty('label');
				expect(t).toHaveProperty('description');
				expect(t).toHaveProperty('target');
				expect(t).toHaveProperty('requiresReboot');
				expect(t).toHaveProperty('riskLevel');
				expect(['low', 'medium', 'high']).toContain(t.riskLevel);
			}
		});

		it('returns 401 without auth', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/types`),
			);
			expect(response.status).toBe(401);
		});
	});

	describe('Authentication & Authorization', () => {
		it('GET /artifacts returns 401 without auth', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts`),
			);
			expect(response.status).toBe(401);
		});

		it('GET /artifacts returns 403 for non-member', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts`, {
					headers: { Cookie: otherCookie },
				}),
			);
			expect(response.status).toBe(403);
		});

		it('DELETE /artifacts/:id returns 403 for non-member', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/fake-id`, {
					method: 'DELETE',
					headers: { Cookie: otherCookie },
				}),
			);
			expect(response.status).toBe(403);
		});
	});

	describe('Validation', () => {
		it('PUT /artifacts/:id returns 400 for empty description', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/fake-id`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({ description: '' }),
				}),
			);
			expect(response.status).toBe(400);
		});
	});
});
