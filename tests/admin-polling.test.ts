import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createApp } from '../src/app';
import {
	getPollingTimeState,
	isValidPollingSec,
	pollingTimeToSeconds,
	secondsToPollingTime,
} from '../src/common/hawkbit/system-config';
import { cleanAll } from './test-helpers';

const SUPER_ADMIN_EMAIL = 'admin-test@ninbus.com.br';
const PASSWORD = 'TestPassword123!';

let app: ReturnType<typeof createApp>;

async function signIn(email: string): Promise<string> {
	await app.handle(
		new Request('http://localhost/api/auth/sign-up/email', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email, password: PASSWORD, name: 'Polling Test' }),
		}),
	);
	const res = await app.handle(
		new Request('http://localhost/api/auth/sign-in/email', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email, password: PASSWORD }),
		}),
	);
	return res.headers.getSetCookie().join('; ');
}

async function pollingRequest(method: 'GET' | 'PUT', cookie: string, body?: unknown) {
	return app.handle(
		new Request('http://localhost/api/admin/polling', {
			method,
			headers: {
				cookie,
				'Content-Type': 'application/json',
			},
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
		}),
	);
}

describe('Admin global polling time', () => {
	beforeAll(async () => {
		app = createApp();
	});

	afterAll(async () => {
		await cleanAll();
	});

	describe('pure helpers', () => {
		it('converts seconds to HH:MM:SS and back', () => {
			expect(secondsToPollingTime(5)).toBe('00:00:05');
			expect(secondsToPollingTime(300)).toBe('00:05:00');
			expect(secondsToPollingTime(86_400)).toBe('24:00:00');
			expect(pollingTimeToSeconds('00:05:00')).toBe(300);
			expect(pollingTimeToSeconds(secondsToPollingTime(3_723))).toBe(3_723);
		});

		it('accepts only integers within the 5s-24h bounds', () => {
			expect(isValidPollingSec(5)).toBe(true);
			expect(isValidPollingSec(86_400)).toBe(true);
			expect(isValidPollingSec(4)).toBe(false);
			expect(isValidPollingSec(86_401)).toBe(false);
			expect(isValidPollingSec(0)).toBe(false);
			expect(isValidPollingSec(-30)).toBe(false);
			expect(isValidPollingSec(30.5)).toBe(false);
			expect(isValidPollingSec('300')).toBe(false);
		});
	});

	describe('GET /api/admin/polling', () => {
		it('returns 401 without a session', async () => {
			const res = await pollingRequest('GET', '');
			expect(res.status).toBe(401);
		});

		it('returns 403 for a regular authenticated user', async () => {
			const cookie = await signIn(`polling-regular-${Date.now()}@example.com`);
			const res = await pollingRequest('GET', cookie);
			expect(res.status).toBe(403);
		});

		it('returns the env default with its source for a super admin', async () => {
			const cookie = await signIn(SUPER_ADMIN_EMAIL);
			const res = await pollingRequest('GET', cookie);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.data.source).toBe('env-default');
			expect(body.data.effectiveSec).toBe(pollingTimeToSeconds('00:05:00'));
			expect(body.data.updatedAt).toBeNull();
		});
	});

	describe('PUT /api/admin/polling', () => {
		it('returns 403 for a non-super admin even with a valid session', async () => {
			const cookie = await signIn(`polling-put-${Date.now()}@example.com`);
			const res = await pollingRequest('PUT', cookie, { pollingSec: 300 });
			expect(res.status).toBe(403);
		});

		it('rejects values outside the bounds with 400', async () => {
			const cookie = await signIn(SUPER_ADMIN_EMAIL);
			for (const pollingSec of [4, 86_401, -1, 12.5]) {
				const res = await pollingRequest('PUT', cookie, { pollingSec });
				expect(res.status).toBe(400);
			}
		});

		it('rejects with 400 when hawkBit is disabled and persists nothing', async () => {
			const cookie = await signIn(SUPER_ADMIN_EMAIL);
			const res = await pollingRequest('PUT', cookie, { pollingSec: 600 });
			expect(res.status).toBe(400);

			const state = await getPollingTimeState();
			expect(state.source).toBe('env-default');
			expect(state.effectiveSec).toBe(300);
		});
	});

	describe('override resolution (real table)', () => {
		it('a stored override wins over the env default and is served with its source', async () => {
			const { db } = await import('@common/db');
			const { platformSettings } = await import('@common/db/schema');
			const { eq } = await import('drizzle-orm');
			const { POLLING_SETTINGS_KEY, clearPollingTimeCache } = await import(
				'../src/common/hawkbit/system-config'
			);

			await db
				.insert(platformSettings)
				.values({ key: POLLING_SETTINGS_KEY, value: '600' })
				.onConflictDoUpdate({ target: platformSettings.key, set: { value: '600' } });
			clearPollingTimeCache();

			const cookie = await signIn(SUPER_ADMIN_EMAIL);
			const res = await pollingRequest('GET', cookie);
			const body = await res.json();
			expect(body.data.source).toBe('override');
			expect(body.data.effectiveSec).toBe(600);

			await db.delete(platformSettings).where(eq(platformSettings.key, POLLING_SETTINGS_KEY));
			clearPollingTimeCache();
		});
	});
});
