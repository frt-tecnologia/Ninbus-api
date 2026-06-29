import { hawkbitConfig } from '@common/config/hawkbit';
import { withAuth } from '@common/middleware/auth-guard';
import {
	ErrorResponseSchema,
	HawkbitActionsResponseSchema,
	HawkbitAttributesResponseSchema,
} from '@modules/devices/schemas';
import { Elysia, t } from 'elysia';
import { loadDevice, requireHawkbitLink } from './auth';
import * as service from './service';

/**
 * Device hawkBit operations — attributes, actions, cancel.
 *
 * Role requirements:
 * - GET /:deviceId/attributes          → viewer (read-only data from hawkBit)
 * - GET /:deviceId/actions             → viewer (deployment history)
 * - DELETE /:deviceId/actions/:actionId → operator (cancel deployment)
 */
export const deviceHawkbitRoutes = withAuth(
	new Elysia({ prefix: '/api/companies/:companyId/devices' }),
)
	// GET /:deviceId/ddi-check — DDI diagnostic for device
	.get(
		'/:deviceId/ddi-check',
		async ({ params, set }: any) => {
			if (!hawkbitConfig.enabled) {
				set.status = 400;
				return { error: 'Bad Request', message: 'hawkBit integration is disabled' };
			}
			const result = await loadDevice(params.deviceId, params.companyId);
			if ('status' in result) {
				set.status = result.status;
				return result.body;
			}
			const linkErr = requireHawkbitLink(result.device);
			if (linkErr) {
				set.status = linkErr.status;
				return linkErr.body;
			}
			try {
				const { checkDDiReadiness } = await import('@modules/deployments/ddi-diagnostics');
				const diag = await checkDDiReadiness(result.device.hawkbitTargetId);
				return { data: diag };
			} catch (error: any) {
				set.status = 503;
				return { error: 'Service Unavailable', message: 'hawkBit is currently unavailable' };
			}
		},
		{
			auth: true,
			companyRole: 'operator',
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				deviceId: t.String({ format: 'uuid' }),
			}),
			detail: {
				tags: ['Devices'],
				summary: 'Check if device would receive deploymentBase via DDI',
				description:
					'Diagnostic endpoint that simulates what the device would see when polling DDI. ' +
					'Checks for active update/cancel actions, DS completeness, and potential blockers.',
			},
			response: { 200: t.Object({ data: t.Any() }), 400: ErrorResponseSchema, 403: ErrorResponseSchema },
		},
	)

	// GET /:deviceId/attributes — Target attributes
	.get(
		'/:deviceId/attributes',
		async ({ params, set }: any) => {
			const result = await loadDevice(params.deviceId, params.companyId);
			if ('status' in result) {
				set.status = result.status;
				return result.body;
			}
			const linkErr = requireHawkbitLink(result.device);
			if (linkErr) {
				set.status = linkErr.status;
				return linkErr.body;
			}
			const attributes = await service.getHawkbitTargetAttributes(result.device.hawkbitTargetId);
			return { data: attributes };
		},
		{
			auth: true,
			companyRole: 'viewer',
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				deviceId: t.String({ format: 'uuid' }),
			}),
			response: { 200: HawkbitAttributesResponseSchema, 403: ErrorResponseSchema },
			detail: {
				tags: ['Devices'],
				summary: 'Get device attributes',
				description: 'Target attributes from hawkBit (hardware, software, custom properties)',
			},
		},
	)

	// GET /:deviceId/actions — Deployment actions for this target
	.get(
		'/:deviceId/actions',
		async ({ params, set }: any) => {
			const result = await loadDevice(params.deviceId, params.companyId);
			if ('status' in result) {
				set.status = result.status;
				return result.body;
			}
			const linkErr = requireHawkbitLink(result.device);
			if (linkErr) {
				set.status = linkErr.status;
				return linkErr.body;
			}
			const actions = await service.getHawkbitTargetActions(result.device.hawkbitTargetId);
			return { data: actions };
		},
		{
			auth: true,
			companyRole: 'viewer',
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				deviceId: t.String({ format: 'uuid' }),
			}),
			response: { 200: HawkbitActionsResponseSchema, 403: ErrorResponseSchema },
			detail: {
				tags: ['Devices'],
				summary: 'Get deployment actions for device',
				description: 'Lists all deployment actions for this target.',
			},
		},
	)

	// DELETE /:deviceId/actions/:actionId — Cancel a deployment action
	.delete(
		'/:deviceId/actions/:actionId',
		async ({ params, set }: any) => {
			const result = await loadDevice(params.deviceId, params.companyId);
			if ('status' in result) {
				set.status = result.status;
				return result.body;
			}
			const linkErr = requireHawkbitLink(result.device);
			if (linkErr) {
				set.status = linkErr.status;
				return linkErr.body;
			}
			try {
				await service.cancelHawkbitAction(result.device.hawkbitTargetId, Number(params.actionId));
				return { message: 'Action cancelled successfully' };
			} catch (error: any) {
				if (error?.status === 404) {
					set.status = 404;
					return { error: 'Not Found', message: 'Action not found' };
				}
				throw error;
			}
		},
		{
			auth: true,
			companyRole: 'operator',
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				deviceId: t.String({ format: 'uuid' }),
				actionId: t.String({ description: 'hawkBit action ID' }),
			}),
			response: {
				200: t.Object({ message: t.String() }),
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
			detail: {
				tags: ['Devices'],
				summary: 'Cancel deployment action',
				description: 'Cancels an active deployment action. Requires operator role or above.',
			},
		},
	);
