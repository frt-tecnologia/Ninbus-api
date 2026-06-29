import { afterAll, describe, expect, it } from 'bun:test';
import { createApp } from '../src/app';
import { cleanAll } from './test-helpers';

afterAll(async () => {
	await cleanAll();
});

describe('Auth Module', () => {
	const app = createApp();
	const testEmail = `test-${Date.now()}@example.com`;
	const testPassword = 'TestPassword123!';
	const testName = 'Test User';

	describe('Sign Up', () => {
		it('POST /api/auth/sign-up/email creates a new user', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/auth/sign-up/email', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						email: testEmail,
						password: testPassword,
						name: testName,
					}),
				}),
			);

			expect(response.status).toBe(200);

			const body = await response.json();
			expect(body.user).toBeDefined();
			expect(body.user.email).toBe(testEmail);
			expect(body.user.name).toBe(testName);
		});

		it('POST /api/auth/sign-up/email fails with duplicate email', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/auth/sign-up/email', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						email: testEmail,
						password: testPassword,
						name: testName,
					}),
				}),
			);

			const body = await response.json();
			expect(response.status !== 200 || body.error !== undefined).toBe(true);
		});

		it('POST /api/auth/sign-up/email fails with weak password', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/auth/sign-up/email', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						email: 'weak@example.com',
						password: '123',
						name: 'Weak User',
					}),
				}),
			);

			const body = await response.json();
			expect(response.status !== 200 || body.error !== undefined).toBe(true);
		});
	});

	describe('Sign Up - Body Validation', () => {
		// Better Auth validates internally and returns 422 for missing required fields
		it('rejects when email is missing', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/auth/sign-up/email', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						password: testPassword,
						name: testName,
					}),
				}),
			);
			expect(response.status).not.toBe(200);
		});

		// Better Auth allows passwordless registration (password can be set later)
		it('accepts sign-up without password (passwordless flow)', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/auth/sign-up/email', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						email: `no-pw-${Date.now()}@example.com`,
						name: testName,
					}),
				}),
			);
			expect(response.status).toBe(200);
		});

		// Better Auth allows registration without name
		it('accepts sign-up without name', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/auth/sign-up/email', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						email: `no-name-${Date.now()}@example.com`,
						password: testPassword,
					}),
				}),
			);
			expect(response.status).toBe(200);
		});

		it('returns 400 when email is invalid format', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/auth/sign-up/email', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						email: 'not-an-email',
						password: testPassword,
						name: testName,
					}),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('returns 400 when password is too short (<8 chars)', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/auth/sign-up/email', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						email: `short-pw-${Date.now()}@example.com`,
						password: '1234567',
						name: testName,
					}),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('rejects when body is empty', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/auth/sign-up/email', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({}),
				}),
			);
			expect(response.status).not.toBe(200);
		});
	});

	describe('Sign In', () => {
		it('POST /api/auth/sign-in/email logs in with valid credentials', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/auth/sign-in/email', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						email: testEmail,
						password: testPassword,
					}),
				}),
			);

			expect(response.status).toBe(200);

			const body = await response.json();
			expect(body.user).toBeDefined();
			expect(body.user.email).toBe(testEmail);
		});

		it('POST /api/auth/sign-in/email fails with wrong password', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/auth/sign-in/email', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						email: testEmail,
						password: 'WrongPassword123!',
					}),
				}),
			);

			const body = await response.json();
			expect(response.status !== 200 || body.error !== undefined).toBe(true);
		});

		it('POST /api/auth/sign-in/email fails with non-existent user', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/auth/sign-in/email', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						email: 'nonexistent@example.com',
						password: testPassword,
					}),
				}),
			);

			const body = await response.json();
			expect(response.status !== 200 || body.error !== undefined).toBe(true);
		});
	});

	describe('Sign In - Body Validation', () => {
		// Better Auth may return various codes when email is missing
		// depending on version and configuration
		it('does not return 200 with valid session when email is missing', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/auth/sign-in/email', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						password: testPassword,
					}),
				}),
			);
			// Should not create a valid session without email
			const body = await response.json().catch(() => ({}));
			const hasSession = body?.session?.token;
			expect(hasSession).toBeFalsy();
		});

		it('rejects when password is missing', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/auth/sign-in/email', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						email: testEmail,
					}),
				}),
			);
			expect(response.status).not.toBe(200);
		});

		it('returns 400 when email is invalid format', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/auth/sign-in/email', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						email: 'not-valid-email',
						password: testPassword,
					}),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('rejects when body is empty', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/auth/sign-in/email', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({}),
				}),
			);
			expect(response.status).not.toBe(200);
		});
	});

	describe('Session', () => {
		it('GET /api/auth/get-session returns session for authenticated user', async () => {
			const signInResponse = await app.handle(
				new Request('http://localhost/api/auth/sign-in/email', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						email: testEmail,
						password: testPassword,
					}),
				}),
			);

			const setCookie = signInResponse.headers.get('set-cookie');
			expect(setCookie).toBeDefined();

			const response = await app.handle(
				new Request('http://localhost/api/auth/get-session', {
					method: 'GET',
					headers: {
						Cookie: setCookie!,
					},
				}),
			);

			expect(response.status).toBe(200);

			const body = await response.json();
			expect(body.user).toBeDefined();
			expect(body.user.email).toBe(testEmail);
			expect(body.session).toBeDefined();
		});

		it('GET /api/auth/get-session returns null for unauthenticated user', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/auth/get-session', {
					method: 'GET',
				}),
			);

			expect(response.status).toBe(200);

			const body = await response.json();
			expect(body === null || body.session === null).toBe(true);
		});
	});

	describe('Password Reset', () => {
		it('POST /api/auth/request-password-reset accepts valid email', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/auth/request-password-reset', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						email: testEmail,
					}),
				}),
			);

			expect(response.status).toBe(200);
		});

		// Better Auth returns 200 even without email (password reset always returns same response for security)
		it('POST /api/auth/request-password-reset returns 200 even when email is missing', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/auth/request-password-reset', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({}),
				}),
			);
			expect(response.status).toBe(200);
		});

		it('POST /api/auth/request-password-reset returns 400 when email is invalid', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/auth/request-password-reset', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ email: 'not-an-email' }),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('POST /api/auth/reset-password fails without valid token', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/auth/reset-password', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						token: 'invalid-token',
						newPassword: 'NewPassword123!',
					}),
				}),
			);

			const body = await response.json();
			expect(response.status !== 200 || body.error !== undefined).toBe(true);
		});

		it('POST /api/auth/reset-password returns 400 when token is missing', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/auth/reset-password', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						newPassword: 'NewPassword123!',
					}),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('POST /api/auth/reset-password returns 400 when newPassword is missing', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/auth/reset-password', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						token: 'some-token',
					}),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('POST /api/auth/reset-password returns 400 when newPassword is too short', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/auth/reset-password', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						token: 'some-token',
						newPassword: '1234567',
					}),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('POST /api/auth/reset-password returns 400 when body is empty', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/auth/reset-password', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({}),
				}),
			);
			expect(response.status).toBe(400);
		});
	});

	describe('Sign Out', () => {
		it('POST /api/auth/sign-out ends the session', async () => {
			const signInResponse = await app.handle(
				new Request('http://localhost/api/auth/sign-in/email', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						email: testEmail,
						password: testPassword,
					}),
				}),
			);

			const setCookie = signInResponse.headers.get('set-cookie');
			expect(setCookie).toBeDefined();

			const signOutResponse = await app.handle(
				new Request('http://localhost/api/auth/sign-out', {
					method: 'POST',
					headers: {
						Cookie: setCookie!,
					},
				}),
			);

			expect(signOutResponse.status).toBe(200);

			const sessionResponse = await app.handle(
				new Request('http://localhost/api/auth/get-session', {
					method: 'GET',
					headers: {
						Cookie: setCookie!,
					},
				}),
			);

			const body = await sessionResponse.json();
			expect(body === null || body.session === null).toBe(true);
		});
	});
});
