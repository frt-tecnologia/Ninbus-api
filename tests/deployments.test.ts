import { afterAll, describe, expect, it } from 'bun:test';
import { createApp } from '../src/app';
import { computeDeploymentStatus, summarizeStatistics } from '../src/modules/deployments/service';
import { cleanAll } from './test-helpers';

afterAll(async () => {
	await cleanAll();
});

describe('Deployments Module', () => {
	const app = createApp();
	const ownerEmail = `dep-owner-${Date.now()}@example.com`;
	const otherEmail = `dep-other-${Date.now()}@example.com`;
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

	async function setupCompany(cookie: string): Promise<string> {
		const response = await app.handle(
			new Request('http://localhost/api/companies', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: cookie },
				body: JSON.stringify({ name: 'Deployment Test Company' }),
			}),
		);
		return (await response.json()).data.id;
	}

	describe('Setup', () => {
		it('creates company', async () => {
			ownerCookie = await signUpAndIn(ownerEmail, 'Deployment Owner');
			otherCookie = await signUpAndIn(otherEmail, 'Other User');
			companyId = await setupCompany(ownerCookie);
			expect(companyId).toBeDefined();
		});
	});

	describe('Artifact Types', () => {
		it('GET /artifact-types returns 3 types', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/deployments/artifact-types`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.data.length).toBe(3);
		});

		it('each type has riskLevel', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/deployments/artifact-types`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			const body = await response.json();
			for (const type of body.data) {
				expect(type.riskLevel).toBeDefined();
				expect(['low', 'medium', 'high']).toContain(type.riskLevel);
			}
		});

		it('each type has requiresReboot boolean', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/deployments/artifact-types`, {
					headers: { Cookie: ownerCookie },
				}),
			);
			const body = await response.json();
			for (const type of body.data) {
				expect(typeof type.requiresReboot).toBe('boolean');
			}
		});

		it('returns 403 for non-member', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/deployments/artifact-types`, {
					headers: { Cookie: otherCookie },
				}),
			);
			expect(response.status).toBe(403);
		});
	});

	describe('Create Deployment Validation', () => {
		it('POST without artifactType returns 400', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/deployments`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({
						name: 'Test Deployment',
						artifactName: 'test-artifact',
						allDevices: true,
					}),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('POST with invalid artifactType returns 400', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/deployments`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({
						name: 'Test Deployment',
						artifactName: 'test-artifact',
						artifactType: 'invalid-type',
						allDevices: true,
					}),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('POST without target spec returns 400', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/deployments`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
					body: JSON.stringify({
						name: 'Test Deployment',
						artifactName: 'test-artifact',
						artifactType: 'firmware-ninbus',
					}),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('POST with valid artifactType passes validation', async () => {
			const types = ['firmware-ninbus', 'firmware-controller', 'configuration-nfx'];
			for (const type of types) {
				const response = await app.handle(
					new Request(`http://localhost/api/companies/${companyId}/deployments`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
						body: JSON.stringify({
							name: `Test ${type}`,
							artifactName: `test-${type}`,
							artifactType: type,
							allDevices: true,
						}),
					}),
				);
				// Will fail with 500/422 because hawkBit is disabled in tests
				// But should NOT return 400 (validation error)
				expect(response.status).not.toBe(400);
			}
		});

		it('returns 401 without auth', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/deployments`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						name: 'Test',
						artifactName: 'test',
						artifactType: 'firmware-ninbus',
						allDevices: true,
					}),
				}),
			);
			expect(response.status).toBe(401);
		});

		it('returns 403 for non-member', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/deployments`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: otherCookie },
					body: JSON.stringify({
						name: 'Test',
						artifactName: 'test',
						artifactType: 'firmware-ninbus',
						allDevices: true,
					}),
				}),
			);
			expect(response.status).toBe(403);
		});
	});

	describe('Deployment Status Computation', () => {
		it('RETRIEVED maps to in_progress', () => {
			expect(computeDeploymentStatus({ RETRIEVED: 1, total: 1 }, 1)).toBe('in_progress');
			const summary = summarizeStatistics({ RETRIEVED: 1, total: 1 });
			expect(summary.inProgress).toBe(1);
			expect(summary.totalTargets).toBe(1);
		});

		it('FINISHED (all) maps to completed', () => {
			expect(computeDeploymentStatus({ FINISHED: 3, total: 3 }, 3)).toBe('completed');
			const summary = summarizeStatistics({ FINISHED: 3, total: 3 });
			expect(summary.finished).toBe(3);
		});

		it('ERROR maps to failed', () => {
			expect(computeDeploymentStatus({ ERROR: 1, FINISHED: 2, total: 3 }, 3)).toBe('failed');
			expect(summarizeStatistics({ ERROR: 1, WARNING: 1, total: 2 }).failed).toBe(2);
		});

		it('CANCELED (all) maps to canceled', () => {
			expect(computeDeploymentStatus({ CANCELED: 2, total: 2 }, 2)).toBe('canceled');
		});

		it('RUNNING maps to pending (device has not polled yet)', () => {
			expect(computeDeploymentStatus({ RUNNING: 5, total: 5 }, 5)).toBe('pending');
			const summary = summarizeStatistics({ RUNNING: 5, total: 5 });
			expect(summary.pending).toBe(5);
			expect(summary.inProgress).toBe(0);
		});

		it('DOWNLOAD/DOWNLOADED maps to in_progress', () => {
			expect(computeDeploymentStatus({ DOWNLOAD: 1, total: 1 }, 1)).toBe('in_progress');
			expect(computeDeploymentStatus({ DOWNLOADED: 1, total: 1 }, 1)).toBe('in_progress');
		});

		it('total=0 maps to no_targets', () => {
			expect(computeDeploymentStatus({}, 0)).toBe('no_targets');
		});

		it('mixed RETRIEVED+FINISHED maps to in_progress', () => {
			expect(computeDeploymentStatus({ FINISHED: 2, RETRIEVED: 1, total: 3 }, 3)).toBe('in_progress');
			const summary = summarizeStatistics({ FINISHED: 2, RETRIEVED: 1, total: 3 });
			expect(summary.finished).toBe(2);
			expect(summary.inProgress).toBe(1);
		});
	});

	describe('Auth & Authorization', () => {
		it('GET / returns 403 for non-member', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/deployments`, {
					headers: { Cookie: otherCookie },
				}),
			);
			expect(response.status).toBe(403);
		});

		it('GET /:deploymentId returns 401 without auth', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/deployments/999`, {
					headers: {},
				}),
			);
			expect(response.status).toBe(401);
		});
	});
});
