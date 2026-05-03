import { withAuth } from '@common/middleware/auth-guard';
import {
	ErrorResponseSchema,
	GenericActionResponseSchema,
	MenderAuthActionSchema,
	MenderInventoryResponseSchema,
} from '@modules/devices/schemas';
import { Elysia, t } from 'elysia';
import { checkMembership, loadDevice, requireMenderLink } from './auth';
import * as service from './service';

/**
 * Device Mender operations — approve, reject, decommission, inventory, connection, check-update.
 * These routes require the device to be linked to Mender.
 */
export const deviceMenderRoutes = withAuth(
	new Elysia({ prefix: '/api/companies/:companyId/devices' }),
)
	// POST /:deviceId/approve — Approve device in Mender
	.post(
		'/:deviceId/approve',
		async ({ params, body, user, set }: any) => {
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
			const linkErr = requireMenderLink(result.device);
			if (linkErr) {
				set.status = linkErr.status;
				return linkErr.body;
			}
			await service.approveDevice(params.deviceId, result.device.menderDeviceId, body.authId);
			return { message: 'Device approved successfully' };
		},
		{
			auth: true,
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				deviceId: t.String({ format: 'uuid' }),
			}),
			body: MenderAuthActionSchema,
			response: {
				200: GenericActionResponseSchema,
				403: ErrorResponseSchema,
			},
			detail: { tags: ['Devices'], summary: 'Approve device in Mender' },
		},
	)

	// POST /:deviceId/reject — Reject device in Mender
	.post(
		'/:deviceId/reject',
		async ({ params, body, user, set }: any) => {
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
			const linkErr = requireMenderLink(result.device);
			if (linkErr) {
				set.status = linkErr.status;
				return linkErr.body;
			}
			await service.rejectDevice(params.deviceId, result.device.menderDeviceId, body.authId);
			return { message: 'Device rejected successfully' };
		},
		{
			auth: true,
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				deviceId: t.String({ format: 'uuid' }),
			}),
			body: MenderAuthActionSchema,
			response: {
				200: GenericActionResponseSchema,
				403: ErrorResponseSchema,
			},
			detail: { tags: ['Devices'], summary: 'Reject device in Mender' },
		},
	)

	// POST /:deviceId/decommission — Decommission device in Mender and local DB
	.post(
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
			const linkErr = requireMenderLink(result.device);
			if (linkErr) {
				set.status = linkErr.status;
				return linkErr.body;
			}
			try {
				await service.decommissionDevice(params.deviceId, result.device.menderDeviceId);
				return { message: 'Device decommissioned successfully' };
			} catch (error: any) {
				if (error?.status === 404) {
					set.status = 404;
					return { error: 'Not Found', message: 'Device not found in Mender' };
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
				description:
					'Removes device from Mender gateway and marks as decommissioned in local registry. ' +
					'The device will no longer receive updates or report inventory.',
			},
		},
	)

	// POST /:deviceId/check-update — Force device to check for updates
	.post(
		'/:deviceId/check-update',
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
			const linkErr = requireMenderLink(result.device);
			if (linkErr) {
				set.status = linkErr.status;
				return linkErr.body;
			}
			await service.forceDeviceCheckUpdate(result.device.menderDeviceId);
			return { message: 'Check-update command sent successfully' };
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
			},
			detail: {
				tags: ['Devices'],
				summary: 'Force device to check for updates',
				description: 'Triggers immediate update check via Device Connect',
			},
		},
	)

	// GET /:deviceId/inventory — Get device inventory from Mender
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
			const linkErr = requireMenderLink(result.device);
			if (linkErr) {
				set.status = linkErr.status;
				return linkErr.body;
			}
			const inventory = await service.getMenderInventory(result.device.menderDeviceId);
			return { data: inventory };
		},
		{
			auth: true,
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				deviceId: t.String({ format: 'uuid' }),
			}),
			response: {
				200: MenderInventoryResponseSchema,
				403: ErrorResponseSchema,
			},
			detail: {
				tags: ['Devices'],
				summary: 'Get device inventory from Mender',
				description: 'Returns hardware/software attributes from Mender inventory',
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
			const linkErr = requireMenderLink(result.device);
			if (linkErr) {
				set.status = linkErr.status;
				return linkErr.body;
			}
			const connectionState = await service.getMenderConnectionState(result.device.menderDeviceId);
			return { data: connectionState };
		},
		{
			auth: true,
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				deviceId: t.String({ format: 'uuid' }),
			}),
			response: {
				200: t.Object({ data: t.Object({ connected: t.Boolean(), ts: t.Optional(t.String()) }) }),
				403: ErrorResponseSchema,
			},
			detail: {
				tags: ['Devices'],
				summary: 'Get device connection state',
				description: 'Returns whether the device is currently connected to Mender gateway',
			},
		},
	);
