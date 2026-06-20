import { appLogger } from '@common/logger';
import { Resend } from 'resend';
import { env } from './env';

/** Error thrown when email sending fails in a context where the failure must surface. */
export class EmailSendError extends Error {
	constructor(
		message: string,
		override readonly cause?: unknown,
	) {
		super(message);
		this.name = 'EmailSendError';
	}
}

/** Shared resolution of production/required behavior. */
function shouldThrow(required: boolean): boolean {
	return required || env.NODE_ENV === 'production';
}

/** True when Resend is usable (key configured). */
function hasResendKey(): boolean {
	return !!env.RESEND_API_KEY && env.RESEND_API_KEY.length > 0;
}

/**
 * Email sending helper using Resend.
 *
 * Behavior:
 * - If RESEND_API_KEY is set and the API call returns an error or throws, we:
 *   - log the failure, AND
 *   - in production (NODE_ENV=production) THROW EmailSendError so callers can
 *     surface a 5xx instead of silently returning success.
 *   - in development, we log only (so local dev without a verified Resend
 *     domain doesn't break the flow) unless `required` is explicitly true.
 * - If RESEND_API_KEY is empty/missing: log a "not sent" notice. Throw in
 *   production when `required` is true (e.g. password reset).
 *
 * @param required When true, a missing key or send failure ALWAYS throws
 *   (regardless of NODE_ENV). Use for user-facing flows where a silent
 *   failure is worse than an error (password reset, email verification).
 */
export const sendEmail = async ({
	to,
	subject,
	text,
	html,
	required = false,
}: {
	to: string;
	subject: string;
	text: string;
	html?: string;
	required?: boolean;
}): Promise<void> => {
	if (!hasResendKey()) {
		appLogger.info({ to, subject, text }, 'Email not sent — RESEND_API_KEY not configured');
		if (required && shouldThrow(required)) {
			throw new EmailSendError(
				'Email service is not configured (RESEND_API_KEY missing). Cannot send required email.',
			);
		}
		return;
	}

	await sendViaResend(
		{
			from: env.EMAIL_FROM,
			to,
			subject,
			text,
			html,
		},
		to,
		subject,
		required,
	);
};

/**
 * Send an email using a Resend Dashboard template (referenced by alias or ID).
 *
 * The template renders the subject + body server-side at Resend; you only pass
 * `from`, `to`, and `variables` (and optionally a `subject` override).
 *
 * @example
 *   sendTemplatedEmail({
 *     to: 'user@example.com',
 *     template: env.RESEND_TEMPLATE_PASSWORD_RESET,  // alias "password-reset"
 *     variables: { first_name: 'John', reset_password_url: 'ninbus://...' },
 *     required: true,
 *   });
 */
export const sendTemplatedEmail = async ({
	to,
	subject,
	template,
	variables = {},
	required = false,
}: {
	to: string;
	subject?: string;
	/** Resend template alias (e.g. "password-reset") or template ID (e.g. "tmpl_xxx"). */
	template: string;
	/** Template variables (string/number values). */
	variables?: Record<string, string | number>;
	required?: boolean;
}): Promise<void> => {
	if (!hasResendKey()) {
		appLogger.info({ to, template, variables }, 'Templated email not sent — RESEND_API_KEY not configured');
		if (required && shouldThrow(required)) {
			throw new EmailSendError(
				'Email service is not configured (RESEND_API_KEY missing). Cannot send required email.',
			);
		}
		return;
	}

	if (!template) {
		throw new EmailSendError(
			'No Resend template identifier provided. Set the template alias/ID in env (e.g. RESEND_TEMPLATE_PASSWORD_RESET).',
		);
	}

	// Resend requires either html/text/react OR template — they are mutually exclusive.
	// When using a template, subject is optional (the template may define its own).
	const payload: Record<string, unknown> = {
		from: env.EMAIL_FROM,
		to,
		template: { id: template, variables },
	};
	if (subject) payload['subject'] = subject;

	await sendViaResend(payload, to, `template:${template}`, required);
};

/** Low-level: send a pre-built payload through the Resend SDK with unified error handling. */
async function sendViaResend(
	payload: Record<string, unknown>,
	to: string,
	label: string,
	required: boolean,
): Promise<void> {
	let result;
	try {
		const resend = new Resend(env.RESEND_API_KEY);
		// The payload shape is one of the union members of CreateEmailOptions;
		// cast via `unknown` because the union type can't be statically inferred
		// from a dynamically-built record (html/text OR template).
		result = await resend.emails.send(payload as unknown as Parameters<typeof resend.emails.send>[0]);
	} catch (error) {
		appLogger.error({ to, label, error }, 'Error sending email via Resend');
		if (shouldThrow(required)) {
			throw new EmailSendError('Failed to send email via Resend.', error);
		}
		return;
	}

	if (result.error) {
		appLogger.error({ to, label, error: result.error }, 'Resend returned an error');
		if (shouldThrow(required)) {
			throw new EmailSendError(
				`Resend rejected the email: ${result.error.name ?? 'error'} — ${result.error.message ?? 'no message'}`,
				result.error,
			);
		}
	} else {
		appLogger.info({ to, label, id: result.data?.id }, 'Email sent via Resend');
	}
}
