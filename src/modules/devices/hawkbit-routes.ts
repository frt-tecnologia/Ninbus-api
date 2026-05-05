import { withAuth } from '@common/middleware/auth-guard';
import {
	ErrorResponseSchema,
	GenericActionResponseSchema,
	HawkbitActionsResponseSchema,
	HawkbitConnectionResponseSchema,
	HawkbitInventoryResponseSchema,
} from '@modules/devices/schemas';
import { Elysia, t } from 'elysia';
import { checkMembership, loadDevice, requireHawkbitLink } from './auth';
import * as service from './service';

/**
 * Device hawkBit operations — inventory, connection, actions, cancel.
 * These routes require the device to be linked to hawkBit.
 */
export const deviceHawkbitRoutes = withAuth(
	new Elysia({ prefix: '/api/companies/:companyId/devices' }),
)
	// GET /:deviceId/inventory — Get device attributes from hawkBit
	.get(
		'/:deviceId/inventory',
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
			response: {
				200: HawkbitInventoryResponseSchema,
				403: ErrorResponseSchema,
			},
			detail: {
				tags: ['Devices'],
				summary: 'Get device attributes from hawkBit',
				description: 'Returns hardware/software attributes from hawkBit target inventory',
			},
		},
	)

	// GET /:deviceId/connection — Get device connection state
	.get(
		'/:deviceId/connection',
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
			const connectionState = await service.getHawkbitConnectionState(
				result.device.hawkbitTargetId,
			);
			return { data: connectionState };
		},
		{
			auth: true,
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				deviceId: t.String({ format: 'uuid' }),
			}),
			response: {
				200: HawkbitConnectionResponseSchema,
				403: ErrorResponseSchema,
			},
			detail: {
				tags: ['Devices'],
				summary: 'Get device connection state',
				description: 'Returns whether the device is currently connected to hawkBit update server',
			},
		},
	)

	// GET /:deviceId/actions — Get deployment actions for device
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
			response: {
				200: HawkbitActionsResponseSchema,
				403: ErrorResponseSchema,
			},
			detail: {
				tags: ['Devices'],
				summary: 'Get deployment actions for device',
				description: 'Lists all deployment actions (update status) for a specific device',
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
				200: GenericActionResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
			detail: {
				tags: ['Devices'],
				summary: 'Cancel deployment action',
				description: 'Cancels an active deployment action for a device in hawkBit',
			},
		},
	)

	// DELETE /:deviceId — Decommission device (remove from hawkBit + local DB)
	.delete(
		'/:deviceId/decommission',
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
				await service.deleteDevice(params.deviceId, params.companyId);
				return { message: 'Device decommissioned successfully' };
			} catch (error: any) {
				if (error?.status === 404) {
					set.status = 404;
					return { error: 'Not Found', message: 'Device not found in hawkBit' };
				}
				throw error;
			}
		},
		{
			auth: true,
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				deviceId: t.String({ format: 'uuid' }),
			}),
			response: {
				200: GenericActionResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
			detail: {
				tags: ['Devices'],
				summary: 'Decommission device',
				description: 'Removes device from hawkBit and marks as decommissioned in local registry.',
			},
		},
	);
