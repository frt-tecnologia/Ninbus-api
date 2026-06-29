/**
 * Unit tests for email sending (Resend) — failure propagation & frontend links.
 *
 * Covers the fix for H5 (silent failures): sendEmail must surface failures via
 * EmailSendError when `required: true`, instead of only logging.
 *
 * The Resend SDK is mocked via globalThis so the factory closure can be steered
 * from inside each test (mock.module factories run in an isolated scope and
 * cannot close over local test variables).
 */
import { mock, describe, test, expect, beforeEach, afterEach } from 'bun:test';

// globalThis bridge so the mocked module can read a value set from each test.
declare global {
	// eslint-disable-next-line no-var
	var __resendSendImpl: ((args: unknown) => Promise<unknown>) | null;
}
globalThis.__resendSendImpl = null;

mock.module('resend', () => ({
	Resend: class {
		emails = {
			send: (args: unknown) =>
				globalThis.__resendSendImpl
					? globalThis.__resendSendImpl(args)
					: Promise.resolve({ data: { id: 'fake-id' }, error: null }),
		};
	},
}));

const { EmailSendError, sendEmail, sendTemplatedEmail } = await import('@common/config/email');
import type { EmailSendError as EmailSendErrorType } from '@common/config/email';
const { env } = await import('@common/config/env');

const realKey = env.RESEND_API_KEY;

beforeEach(() => {
	globalThis.__resendSendImpl = null;
	env.RESEND_API_KEY = 're_test_key_for_unit_tests';
});

afterEach(() => {
	env.RESEND_API_KEY = realKey;
});

describe('sendTemplatedEmail — Resend dashboard template', () => {
	test('sends payload with template id + variables, no html/text', async () => {
		let captured: any = null;
		globalThis.__resendSendImpl = (args) => {
			captured = args;
			return Promise.resolve({ data: { id: 'tmpl-ok' }, error: null });
		};
		await sendTemplatedEmail({
			to: 'user@example.com',
			template: 'password-reset',
			variables: { first_name: 'John', reset_password_url: 'ninbus://reset-password?token=X' },
			required: true,
		});
		expect(captured).not.toBeNull();
		expect(captured.to).toBe('user@example.com');
		expect(captured.template).toEqual({ id: 'password-reset', variables: { first_name: 'John', reset_password_url: 'ninbus://reset-password?token=X' } });
		expect(captured.html).toBeUndefined();
		expect(captured.text).toBeUndefined();
	});

	test('includes optional subject override', async () => {
		let captured: any = null;
		globalThis.__resendSendImpl = (args) => { captured = args; return Promise.resolve({ data: { id: 'ok' }, error: null }); };
		await sendTemplatedEmail({ to: 'u@e.com', subject: 'Custom Subject', template: 't', variables: {} });
		expect(captured['subject']).toBe('Custom Subject');
		expect(captured.template.id).toBe('t');
	});

	test('throws EmailSendError when template identifier is empty', async () => {
		await expect(
			sendTemplatedEmail({ to: 'u@e.com', template: '', variables: {}, required: true }),
		).rejects.toBeInstanceOf(EmailSendError);
	});

	test('throws EmailSendError when required AND Resend rejects the template', async () => {
		globalThis.__resendSendImpl = () =>
			Promise.resolve({ data: null, error: { name: 'validation_error', message: 'template not found' } });
		await expect(
			sendTemplatedEmail({ to: 'u@e.com', template: 'missing-tpl', variables: {}, required: true }),
		).rejects.toBeInstanceOf(EmailSendError);
	});
});

describe('sendEmail — failure propagation', () => {
	test('resolves when Resend succeeds', async () => {
		globalThis.__resendSendImpl = () => Promise.resolve({ data: { id: 'ok-123' }, error: null });
		await expect(sendEmail({ to: 'a@b.com', subject: 's', text: 't' })).resolves.toBeUndefined();
	});

	test('throws EmailSendError when required AND Resend returns an error', async () => {
		globalThis.__resendSendImpl = () =>
			Promise.resolve({
				data: null,
				error: { name: 'validation_error', message: 'domain not verified' },
			});
		await expect(
			sendEmail({ to: 'a@b.com', subject: 's', text: 't', required: true }),
		).rejects.toBeInstanceOf(EmailSendError);
	});

	test('throws EmailSendError when required AND the SDK throws', async () => {
		globalThis.__resendSendImpl = () => Promise.reject(new Error('network down'));
		await expect(
			sendEmail({ to: 'a@b.com', subject: 's', text: 't', required: true }),
		).rejects.toBeInstanceOf(EmailSendError);
	});

	test('does NOT throw when not required and Resend returns an error (dev best-effort)', async () => {
		globalThis.__resendSendImpl = () =>
			Promise.resolve({ data: null, error: { name: 'validation_error', message: 'x' } });
		// NODE_ENV is 'test' here → not production, not required → should swallow.
		await expect(
			sendEmail({ to: 'a@b.com', subject: 's', text: 't' }),
		).resolves.toBeUndefined();
	});

	test('EmailSendError message includes the Resend error name', async () => {
		globalThis.__resendSendImpl = () =>
			Promise.resolve({ data: null, error: { name: 'validation_error', message: 'bad' } });
		try {
			await sendEmail({ to: 'a@b.com', subject: 's', text: 't', required: true });
			expect.unreachable('should have thrown');
		} catch (e) {
			expect(e).toBeInstanceOf(EmailSendError);
			expect((e as EmailSendErrorType).message).toContain('validation_error');
		}
	});
});
