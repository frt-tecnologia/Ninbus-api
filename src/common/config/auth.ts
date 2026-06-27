import { db } from '@common/db';
import { appLogger } from '@common/logger';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins/bearer';
import { buildAppDeepLink } from './deep-link';
import { sendEmail, sendTemplatedEmail } from './email';
import { env } from './env';

/** Extract a first name from a user's full name (defensive — never throws). */
function firstNameOf(fullName: string | null | undefined): string {
	if (!fullName) return '';
	return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/**
 * Better Auth configuration
 * Defines authentication methods, session behavior, and database integration
 * Review security defaults before production deployment
 */
export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: 'pg',
	}),
	trustedOrigins: env.CORS_ORIGIN,
	emailAndPassword: {
		enabled: true,
		minPasswordLength: 8,
		maxPasswordLength: 128,
		requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION,

		// Password reset - enables /api/auth/request-password-reset endpoint
		sendResetPassword: async ({ user, url, token }, _request) => {
			const resetLink = buildAppDeepLink(url, token, 'reset-password');
			const template = env.RESEND_TEMPLATE_PASSWORD_RESET;
			if (template) {
				// Resend Dashboard template (alias "password-reset") — renders subject + body at Resend.
				await sendTemplatedEmail({
					to: user.email,
					template,
					variables: {
						first_name: firstNameOf(user.name),
						reset_password_url: resetLink,
					},
					// Required: a silent failure here means the user can never reset their password.
					required: true,
				});
				return;
			}
			// Fallback: inline HTML (used when no template alias is configured).
			appLogger.warn(
				'RESEND_TEMPLATE_PASSWORD_RESET not set — falling back to inline HTML for password reset email.',
			);
			await sendEmail({
				to: user.email,
				subject: 'Reset your password',
				text: `Click the link to reset your password: ${resetLink}`,
				html: `
					<h2>Reset Your Password</h2>
					<p>Click the link below to reset your password:</p>
					<a href="${resetLink}">Reset Password</a>
					<p>This link will expire in 1 hour.</p>
					<p>If you didn't request this, please ignore this email.</p>
				`,
				required: true,
			});
		},

		// Optional hook after password reset (extend for logging, notifications, etc.)
		onPasswordReset: async ({ user: _user }, _request) => {},
	},
	// Email verification (separate from emailAndPassword)
	emailVerification: {
		sendVerificationEmail: async ({ user, url, token }, _request) => {
			const verifyLink = buildAppDeepLink(url, token, 'verify-email');
			const template = env.RESEND_TEMPLATE_EMAIL_VERIFICATION;
			if (template) {
				await sendTemplatedEmail({
					to: user.email,
					template,
					variables: {
						first_name: firstNameOf(user.name),
						verify_email_url: verifyLink,
					},
					required: true,
				});
				return;
			}
			appLogger.warn(
				'RESEND_TEMPLATE_EMAIL_VERIFICATION not set — falling back to inline HTML for verification email.',
			);
			await sendEmail({
				to: user.email,
				subject: 'Verify your email address',
				text: `Click the link to verify your email: ${verifyLink}`,
				html: `
					<h2>Verify Your Email</h2>
					<p>Click the link below to verify your email address:</p>
					<a href="${verifyLink}">Verify Email</a>
				`,
				required: true,
			});
		},
	},
	plugins: [bearer()],
	session: {
		expiresIn: 60 * 60 * 24 * 7, // 7 days
		updateAge: 60 * 60 * 24, // 1 day
	},
	/**
	 * Database hooks — resolve pending company designations on sign-up.
	 *
	 * When a user registers, we check if any company designated them by email
	 * (via `pending_company_members`). If so, they are automatically granted the
	 * designated role in those companies. This is the "factory onboarding" model:
	 * the factory (super admin) creates the company and designates the owner's
	 * email. The owner simply registers to receive access — no invite links.
	 *
	 * The hook never throws — a DB error here must NOT block user registration.
	 * A safety-net fallback exists in GET /api/companies (resolvePendingMembers).
	 */
	databaseHooks: {
		user: {
			create: {
				after: async (newUser) => {
					// Dynamic import to avoid circular dependency at module load time.
					const { resolvePendingMembers } = await import('@modules/companies/designation');
					if (newUser?.email) {
						await resolvePendingMembers(newUser.email, newUser.id);
					}
				},
			},
		},
	},
	secret: env.BETTER_AUTH_SECRET!,
	baseURL: env.BETTER_AUTH_URL,
	advanced: {
		// Secure cookie defaults (adjust if deploying behind a reverse proxy)
		cookiePrefix: 'auth',
		useSecureCookies: env.NODE_ENV === 'production',
		defaultCookieAttributes: {
			sameSite: 'lax',
			httpOnly: true,
			secure: env.NODE_ENV === 'production',
			path: '/',
		},
	},
});
