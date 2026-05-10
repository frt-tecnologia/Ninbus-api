import { withAuth } from '@common/middleware/auth-guard';
import {
	DeviceCreateResponseSchema,
	DeviceDeleteResponseSchema,
	DeviceListResponseSchema,
	DeviceResponseSchema,
	DeviceUpdateResponseSchema,
	ErrorResponseSchema,
	LinkDeviceResponseSchema,
	linkDeviceSchema,
	registerDeviceSchema,
	updateDeviceSchema,
} from '@modules/devices/schemas';
import { Elysia, t } from 'elysia';
import { loadDevice } from './auth';
import * as service from './service';

/** Params with companyId only */
const companyParams = t.Object({ companyId: t.String({ format: 'uuid' }) });
/** Params with companyId + deviceId */
const deviceParams = t.Object({
	companyId: t.String({ format: 'uuid' }),
	deviceId: t.String({ format: 'uuid' }),
});

/**
 * Devices Module — Ninbus device management with hawkBit integration.
 *
 * Role requirements:
 * - GET /              → viewer (list devices)
 * - POST /             → operator (register/claim device)
 * - GET /:deviceId     → viewer (view details)
 * - PUT /:deviceId     → operator (update name, metadata)
 * - DELETE /:deviceId  → admin (remove device)
 * - PUT /:deviceId/link → operator (link to hawkBit)
 */
export const devicesModule = withAuth(new Elysia({ prefix: '/api/companies/:companyId/devices' }))
	// GET / — List company devices
	.get(
		'/',
		async ({ params }) => {
			const deviceList = await service.getCompanyDevices(params.companyId);
			return { data: deviceList, total: deviceList.length };
		},
		{
			auth: true,
			companyRole: 'viewer',
			params: companyParams,
			detail: { tags: ['Devices'], summary: 'List company devices' },
			response: {
				200: DeviceListResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	)

	// POST / — Claim device for this company
	.post(
		'/',
		async ({ params, body, user, set }) => {
			const result = await service.registerDevice({
				companyId: params.companyId,
				name: body.name || body.serialNumber,
				serialNumber: body.serialNumber,
				userId: user.id,
			});
			if (!result.success) {
				if (result.error === 'Device already claimed by another company') {
					set.status = 409;
					return { error: 'Conflict', message: result.error };
				}
				if (result.error === 'Device already in this company') {
					set.status = 409;
					return { error: 'Conflict', message: result.error };
				}
			}
			set.status = 201;
			return {
				message: result.error || 'Device claimed successfully',
				data: result.device,
			};
		},
		{
			auth: true,
			companyRole: 'operator',
			params: companyParams,
			body: registerDeviceSchema,
			detail: {
				tags: ['Devices'],
				summary: 'Register / claim a device for this company',
				description:
					'Claims a pre-provisioned device by serial number. Requires operator role or above. ' +
					'The device must already exist in hawkBit (provisioned at the factory).',
			},
			response: {
				201: DeviceCreateResponseSchema,
				400: ErrorResponseSchema,
				403: ErrorResponseSchema,
				409: ErrorResponseSchema,
			},
		},
	)

	// GET /:deviceId — Get device details
	.get(
		'/:deviceId',
		async ({ params, set }) => {
			const result = await loadDevice(params.deviceId, params.companyId);
			if ('status' in result) {
				set.status = result.status;
				return result.body;
			}
			let hawkbitInfo = null;
			if (result.device.hawkbitTargetId) {
				try {
					hawkbitInfo = await service.syncDeviceStatusFromHawkbit(result.device.hawkbitTargetId);
				} catch {
					/* hawkBit unavailable */
				}
			}
			return { data: result.device, hawkbit: hawkbitInfo };
		},
		{
			auth: true,
			companyRole: 'viewer',
			params: deviceParams,
			detail: { tags: ['Devices'], summary: 'Get device details' },
			response: {
				200: DeviceResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	)

	// PUT /:deviceId — Update device
	.put(
		'/:deviceId',
		async ({ params, body, set }) => {
			const device = await service.updateDevice(params.deviceId, params.companyId, body);
			if (!device) {
				set.status = 404;
				return { error: 'Not Found', message: 'Device not found' };
			}
			return { message: 'Device updated successfully', data: device };
		},
		{
			auth: true,
			companyRole: 'operator',
			params: deviceParams,
			body: updateDeviceSchema,
			detail: { tags: ['Devices'], summary: 'Update device', description: 'Updates device metadata. Requires operator role or above.' },
			response: {
				200: DeviceUpdateResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	)

	// DELETE /:deviceId — Remove device
	.delete(
		'/:deviceId',
		async ({ params, set }) => {
			const result = await loadDevice(params.deviceId, params.companyId);
			if ('status' in result) {
				set.status = result.status;
				return result.body;
			}
			await service.deleteDevice(params.deviceId, params.companyId);
			return { message: 'Device removed successfully' };
		},
		{
			auth: true,
			companyRole: 'admin',
			params: deviceParams,
			detail: {
				tags: ['Devices'],
				summary: 'Remove device',
				description: 'Removes a device from the company. Requires admin role or above.',
			},
			response: {
				200: DeviceDeleteResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	)

	// PUT /:deviceId/link — Link pending device to hawkBit (admin provides deviceKey)
	.put(
		'/:deviceId/link',
		async ({ params, body, set }) => {
			const result = await service.linkDevice(
				params.deviceId,
				params.companyId,
				body.deviceKey,
			);
			if (!result.success) {
				if (result.error === 'Device not found') {
					set.status = 404;
					return { error: 'Not Found', message: result.error };
				}
				set.status = 409;
				return { error: 'Conflict', message: result.error };
			}
			return { message: 'Device linked to hawkBit successfully', data: result.device };
		},
		{
			auth: true,
			companyRole: 'operator',
			params: deviceParams,
			body: linkDeviceSchema,
			detail: {
				tags: ['Devices'],
				summary: 'Link pending device to hawkBit',
				description:
					'(Legacy) Links a pending device by providing its factory device key. ' +
					'For new deployments, use POST /api/devices/provision instead. Requires operator role or above.',
			},
			response: {
				200: LinkDeviceResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
				409: ErrorResponseSchema,
			},
		},
	);
