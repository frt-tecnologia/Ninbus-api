import { withAuth } from '@common/middleware/auth-guard';
import {
	ErrorResponseSchema,
	HawkbitActionsResponseSchema,
	HawkbitAttributesResponseSchema,
} from '@modules/devices/schemas';
import { Elysia, t } from 'elysia';
import { checkMembership, loadDevice, requireHawkbitLink } from './auth';
import * as service from './service';

/**
 * Device hawkBit operations — attributes, actions, cancel.
 *
 * Simplified from Mender model. hawkBit eliminates:
 * - No approve/reject (targets created directly, no auth flow)
 * - No check-update (hawkBit manages device polling automatically)
 * - No separate connection endpoint (pollStatus is on the target object)
 * - No decommission endpoint (DELETE on the device itself handles it)
 */
export const deviceHawkbitRoutes = withAuth(
	new Elysia({ prefix: '/api/companies/:companyId/devices' }),
)
	// GET /:deviceId/attributes — Target attributes (replaces Mender inventory)
	.get(
		'/:deviceId/attributes',
		async ({ params, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
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
			const attributes = await service.getHawkbitTargetAttributes(result.device.hawkbitTargetId);
			return { data: attributes };
		},
		{
			auth: true,
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				deviceId: t.String({ format: 'uuid' }),
			}),
			response: { 200: HawkbitAttributesResponseSchema, 403: ErrorResponseSchema },
			detail: {
				tags: ['Device hawkBit'],
				summary: 'Get device attributes',
				description: 'Target attributes from hawkBit (hardware, software, custom properties)',
			},
		},
	)

	// GET /:deviceId/actions — Deployment actions for this target
	.get(
		'/:deviceId/actions',
		async ({ params, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
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
			const actions = await service.getHawkbitTargetActions(result.device.hawkbitTargetId);
			return { data: actions };
		},
		{
			auth: true,
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				deviceId: t.String({ format: 'uuid' }),
			}),
			response: { 200: HawkbitActionsResponseSchema, 403: ErrorResponseSchema },
			detail: {
				tags: ['Device hawkBit'],
				summary: 'Get deployment actions for device',
				description: 'Lists all deployment actions for this target. Includes active and completed.',
			},
		},
	)

	// DELETE /:deviceId/actions/:actionId — Cancel a deployment action
	.delete(
		'/:deviceId/actions/:actionId',
		async ({ params, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
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
				tags: ['Device hawkBit'],
				summary: 'Cancel deployment action',
			},
		},
	);
