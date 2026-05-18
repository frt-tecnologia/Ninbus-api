import { afterAll, describe, expect, it } from 'bun:test';
import { createApp } from '../src/app';
import { cleanAll } from './test-helpers';

afterAll(async () => {
	await cleanAll();
});

describe('Artifacts Module', () => {
	const app = createApp();
	const ownerEmail = `art-owner-${Date.now()}@example.com`;
	const otherEmail = `art-other-${Date.now()}@example.com`;
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
				body: JSON.stringify({ name: 'Artifact Test Company' }),
			}),
		);
		return (await response.json()).data.id;
	}

	describe('Setup', () => {
		it('creates company', async () => {
			ownerCookie = await signUpAndIn(ownerEmail, 'Artifact Owner');
			otherCookie = await signUpAndIn(otherEmail, 'Other User');
			companyId = await setupCompany(ownerCookie);
			expect(companyId).toBeDefined();
		});
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
});
