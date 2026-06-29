import { auth } from '@common/config/auth';
import { EmailSendError } from '@common/config/email';
import {
	AuthResponseSchema,
	ErrorResponseSchema,
	RequestPasswordResetBodySchema,
	ResetPasswordBodySchema,
	SignInBodySchema,
	SignUpBodySchema,
	StatusResponseSchema,
	SuccessResponseSchema,
} from '@modules/auth/schemas';
import { Elysia, type Static, t } from 'elysia';

/**
 * Authentication routes powered by Better Auth.
 *
 * NOTE: Body schemas are defined here for Swagger documentation.
 * To avoid "Body already used" errors with Better Auth, we recreate
 * the request with the parsed body before passing it to the handler.
 *
 * Better Auth validates all fields internally (required fields, min/max
 * lengths, email format, etc.), so we delegate body validation entirely
 * to it.
 *
 * Body schemas documented below for Swagger reference:
 *
 * POST /sign-up/email
 *   { email: string (required, valid email), password: string (required, min 8), name: string (required) }
 *
 * POST /sign-in/email
 *   { email: string (required, valid email), password: string (required) }
 *
 * POST /sign-out
 *   (no body — uses session cookie)
 *
 * POST /request-password-reset
 *   { email: string (required, valid email) }
 *
 * POST /reset-password
 *   { token: string (required), newPassword: string (required, min 8) }
 *
 * @see https://elysiajs.com/concepts/life-cycle.html
 * @see https://better-auth.com/docs
 */

export const authModule = new Elysia({ prefix: '/api/auth' })
	// Sign Up with Email
	.post(
		'/sign-up/email',
		({ body, request }) =>
			auth.handler(
				new Request(request.url, {
					method: 'POST',
					headers: request.headers,
					body: JSON.stringify(body),
				}),
			) as unknown as Static<typeof AuthResponseSchema>,
		{
			body: SignUpBodySchema,
			detail: {
				tags: ['Auth'],
				summary: 'Register with email',
				description:
					'Registers a new user with email, password, and name.\n\n' +
					'**Request Body:**\n' +
					'```json\n' +
					'{\n' +
					'  "email": "user@example.com",     // string, required, valid email format\n' +
					'  "password": "SecurePass123!",     // string, required, min 8 characters\n' +
					'  "name": "John Doe"                // string, required\n' +
					'}\n' +
					'```\n\n' +
					'**Responses:**\n' +
					'- `200` — User created, session started (cookie set)\n' +
					'- `400` — Missing/invalid fields (email, password < 8 chars, missing name)\n' +
					'- `409` — Email already registered',
			},
			response: {
				200: AuthResponseSchema,
				400: ErrorResponseSchema,
				409: ErrorResponseSchema,
			},
		},
	)

	// Sign In with Email
	.post(
		'/sign-in/email',
		({ body, request }) =>
			auth.handler(
				new Request(request.url, {
					method: 'POST',
					headers: request.headers,
					body: JSON.stringify(body),
				}),
			) as unknown as Static<typeof AuthResponseSchema>,
		{
			body: SignInBodySchema,
			detail: {
				tags: ['Auth'],
				summary: 'Login with email',
				description:
					'Authenticates a user and starts a session.\n\n' +
					'**Request Body:**\n' +
					'```json\n' +
					'{\n' +
					'  "email": "user@example.com",     // string, required, valid email format\n' +
					'  "password": "SecurePass123!"      // string, required\n' +
					'}\n' +
					'```\n\n' +
					'**Responses:**\n' +
					'- `200` — Session started (cookie set), returns `{ user, session }`\n' +
					'- `400` — Missing/invalid email or password\n' +
					'- `401` — Invalid credentials',
			},
			response: {
				200: AuthResponseSchema,
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
			},
		},
	)

	// Sign Out
	.post(
		'/sign-out',
		({ request }) => auth.handler(request) as unknown as Static<typeof SuccessResponseSchema>,
		{
			detail: {
				tags: ['Auth'],
				summary: 'Logout',
				description:
					'Ends the current user session.\n\n' +
					'**Request Body:** None (uses session cookie)\n\n' +
					'**Responses:**\n' +
					'- `200` — Session ended successfully\n' +
					'- `401` — No active session',
			},
			response: {
				200: SuccessResponseSchema,
				401: ErrorResponseSchema,
			},
		},
	)

	// Get Session
	.get(
		'/get-session',
		({ request }) => auth.handler(request) as unknown as Static<typeof AuthResponseSchema> | null,
		{
			detail: {
				tags: ['Auth'],
				summary: 'Get current session',
				description:
					"Retrieves the authenticated user's session information.\n\n" +
					'**Request Body:** None (uses session cookie)\n\n' +
					'**Responses:**\n' +
					'- `200` — Returns `{ user: { id, name, email, emailVerified, image, createdAt }, session: { id, token, expiresAt } }`\n' +
					'- `null` — No active session (returns null body)',
			},
			response: {
				200: t.Nullable(AuthResponseSchema),
			},
		},
	)

	// Request Password Reset
	.post(
		'/request-password-reset',
		async ({ body, request, set }) => {
			try {
				return await auth.handler(new Request(request.url, {
					method: 'POST', headers: request.headers, body: JSON.stringify(body),
				})) as unknown as Static<typeof StatusResponseSchema>;
			} catch (error) {
				// sendResetPassword throws EmailSendError when Resend fails or is misconfigured.
				// We must NOT silently return 200 (would lie "email sent" when it wasn't).
				if (error instanceof EmailSendError) {
					set.status = 502;
					return { error: 'Bad Gateway', message: 'Could not send password reset email — the email service is unavailable. Please try again later.' } as unknown as Static<typeof StatusResponseSchema>;
				}
				throw error;
			}
		},
		{
			body: RequestPasswordResetBodySchema,
			detail: {
				tags: ['Auth'],
				summary: 'Request password reset',
				description:
					"Sends a password reset link to the user's email.\n\n" +
					'**Request Body:**\n' +
					'```json\n' +
					'{\n' +
					'  "email": "user@example.com"       // string, required, valid email format\n' +
					'}\n' +
					'```\n\n' +
					'**Responses:**\n' +
					'- `200` — Reset email sent (or email not found — same response for security)\n' +
					'- `400` — Missing or invalid email',
			},
			response: {
				200: StatusResponseSchema,
				400: ErrorResponseSchema,
				502: ErrorResponseSchema,
			},
		},
	)

	// Reset Password (after clicking link in email)
	.post(
		'/reset-password',
		({ body, request }) =>
			auth.handler(
				new Request(request.url, {
					method: 'POST',
					headers: request.headers,
					body: JSON.stringify(body),
				}),
			) as unknown as Static<typeof StatusResponseSchema>,
		{
			body: ResetPasswordBodySchema,
			detail: {
				tags: ['Auth'],
				summary: 'Reset password with token',
				description:
					"Resets the user's password using the token from the email reset link.\n\n" +
					'**Request Body:**\n' +
					'```json\n' +
					'{\n' +
					'  "token": "reset-token-from-email",  // string, required\n' +
					'  "newPassword": "NewSecurePass123!"   // string, required, min 8 characters\n' +
					'}\n' +
					'```\n\n' +
					'**Responses:**\n' +
					'- `200` — Password reset successfully\n' +
					'- `400` — Missing token, missing password, or password < 8 chars\n' +
					'- `401` — Invalid or expired token',
			},
			response: {
				200: StatusResponseSchema,
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
			},
		},
	)

	// Catch-all for other Better Auth routes
	.all('/*', ({ request }) => auth.handler(request) as any);
