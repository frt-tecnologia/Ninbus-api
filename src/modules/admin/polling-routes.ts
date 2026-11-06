import { hawkbitConfig } from '@common/config/hawkbit';
import {
	getPollingTimeState,
	isValidPollingSec,
	setPollingTimeSec,
} from '@common/hawkbit/system-config';
import { withAuth } from '@common/middleware/auth-guard';
import { ErrorResponseSchema } from '@common/schemas';
import { Elysia } from 'elysia';
import { PollingTimeResponseSchema, UpdatePollingTimeBodySchema } from './schemas';

export const adminPollingModule = withAuth(new Elysia({ prefix: '/api/admin/polling' }))

	.get('/', async () => ({ data: await getPollingTimeState() }), {
		auth: true,
		superAdmin: true,
		response: {
			200: PollingTimeResponseSchema,
		},
		detail: {
			tags: ['Admin'],
			summary: 'Get effective device polling interval',
			description:
				'Effective DDI polling interval in seconds and its source: a super-admin ' +
				'override stored in platform_settings, or the HAWKBIT_POLLING_TIME env default.',
		},
	})

	.put(
		'/',
		async ({ body, user, set }) => {
			if (!hawkbitConfig.enabled) {
				set.status = 400;
				return {
					error: 'Bad Request',
					message: 'hawkBit integration is disabled (HAWKBIT_ENABLED=false)',
				};
			}
			if (!isValidPollingSec(body.pollingSec)) {
				set.status = 400;
				return {
					error: 'Bad Request',
					message: `pollingSec must be an integer between 5 and 86400 seconds`,
				};
			}
			try {
				const state = await setPollingTimeSec(body.pollingSec, user.id);
				return { data: state };
			} catch {
				set.status = 503;
				return {
					error: 'Service Unavailable',
					message: 'hawkBit is unreachable — polling time not changed',
				};
			}
		},
		{
			auth: true,
			superAdmin: true,
			body: UpdatePollingTimeBodySchema,
			response: {
				200: PollingTimeResponseSchema,
				400: ErrorResponseSchema,
				503: ErrorResponseSchema,
			},
			detail: {
				tags: ['Admin'],
				summary: 'Set the global device polling interval (super admin)',
				description:
					'Validates (integer, 5-86400s), pushes the value to hawkBit ' +
					'(PUT /rest/v1/system/configs/pollingTime) and persists it as the runtime ' +
					'override — nothing is stored when hawkBit rejects the push. ' +
					'The interval must match the firmware poll cadence: a value lower than the ' +
					'real cadence marks devices offline between polls.',
			},
		},
	);
