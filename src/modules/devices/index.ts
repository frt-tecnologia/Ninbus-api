import { withAuth } from '@common/middleware/auth-guard';
import {
	DeviceCreateResponseSchema,
	DeviceDeleteResponseSchema,
	DeviceListResponseSchema,
	DeviceResponseSchema,
	DeviceUpdateResponseSchema,
	ErrorResponseSchema,
	assignCategoriesSchema,
	registerDeviceSchema,
	updateDeviceSchema,
} from '@modules/devices/schemas';
import { Elysia, t } from 'elysia';
import { checkMembership, loadDevice } from './auth';
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
 * All routes scoped under a company. Members can view; operators can manage.
 */
export const devicesModule = withAuth(new Elysia({ prefix: '/api/companies/:companyId/devices' }))
	// GET / — List company devices
	.get(
		'/',
		async ({ params, user, set }) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			const deviceList = await service.getCompanyDevices(params.companyId);
			return { data: deviceList, total: deviceList.length };
		},
		{
			auth: true,
			params: companyParams,
			detail: { tags: ['Devices'], summary: 'List company devices' },
			response: {
				200: DeviceListResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	)

	// POST / — Register device
	.post(
		'/',
		async ({ params, body, user, set }) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			const device = await service.registerDevice({
				companyId: params.companyId,
				name: body.name,
				serialNumber: body.serialNumber,
				hawkbitTargetId: body.hawkbitTargetId,
				userId: user.id,
			});
			set.status = 201;
			return { message: 'Device registered successfully', data: device };
		},
		{
			auth: true,
			params: companyParams,
			body: registerDeviceSchema,
			detail: {
				tags: ['Devices'],
				summary: 'Register a new device',
				description:
					'Registers a Ninbus device to the company. Optionally link to an existing hawkBit target.',
			},
			response: {
				201: DeviceCreateResponseSchema,
				400: ErrorResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	)

	// GET /:deviceId — Get device details
	.get(
		'/:deviceId',
		async ({ params, user, set }) => {
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
		async ({ params, body, user, set }) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			const device = await service.updateDevice(params.deviceId, params.companyId, body);
			if (!device) {
				set.status = 404;
				return { error: 'Not Found', message: 'Device not found' };
			}
			return { message: 'Device updated successfully', data: device };
		},
		{
			auth: true,
			params: deviceParams,
			body: updateDeviceSchema,
			detail: { tags: ['Devices'], summary: 'Update device' },
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
		async ({ params, user, set }) => {
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
			await service.deleteDevice(params.deviceId, params.companyId);
			return { message: 'Device removed successfully' };
		},
		{
			auth: true,
			params: deviceParams,
			detail: { tags: ['Devices'], summary: 'Remove device' },
			response: {
				200: DeviceDeleteResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	)

	// GET /:deviceId/categories — List device categories
	.get(
		'/:deviceId/categories',
		async ({ params, user, set }) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			const cats = await service.getDeviceCategories(params.deviceId);
			return { data: cats, total: cats.length };
		},
		{
			auth: true,
			params: deviceParams,
			detail: { tags: ['Devices'], summary: 'List device categories' },
		},
	)

	// PUT /:deviceId/categories — Assign categories to device
	.put(
		'/:deviceId/categories',
		async ({ params, body, user, set }) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			await service.assignCategories(params.deviceId, body.categoryIds);
			return { message: 'Categories assigned successfully' };
		},
		{
			auth: true,
			params: deviceParams,
			body: assignCategoriesSchema,
			detail: {
				tags: ['Devices'],
				summary: 'Assign categories to device',
				description: 'Replaces all category assignments for a device (N:N relationship)',
			},
		},
	);
