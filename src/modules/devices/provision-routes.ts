/**
 * Provisioning routes — factory / warehouse pre-registration.
 *
 * These routes create hawkBit targets BEFORE any company claims the device.
 * Done at the factory or warehouse with serialNumber + deviceKey from the device label.
 * The device starts polling hawkBit immediately but has no company assignment.
 */
import { hawkbitConfig } from '@common/config/hawkbit';
import { withAuth } from '@common/middleware/auth-guard';
import {
	DeviceCreateResponseSchema,
	DeviceListResponseSchema,
	ErrorResponseSchema,
	provisionDeviceSchema,
	selectDeviceSchema,
} from '@modules/devices/schemas';
import { Elysia, t } from 'elysia';
import { provisionDevice, listUnclaimedDevices, claimDevice } from './provisioning';

export const provisioningRoutes = withAuth(
	new Elysia({ prefix: '/api/devices' }),
)
	// POST /api/devices/provision — Pre-register device (factory/warehouse)
	.post(
		'/provision',
		async ({ body, user, set }) => {
			const result = await provisionDevice({
				serialNumber: body.serialNumber,
				deviceKey: body.deviceKey,
				name: body.name,
				userId: user.id,
			});

			if (!result.success) {
				set.status = result.error === 'Serial number already registered' ? 409 : 500;
				return { error: 'Error', message: result.error! };
			}

			set.status = 201;
			return { message: 'Device provisioned successfully', data: result.device };
		},
		{
			auth: true,
			body: provisionDeviceSchema,
			detail: {
				tags: ['Provisioning'],
				summary: 'Pre-register device in hawkBit (factory/warehouse)',
				description:
					'Creates a hawkBit target with the factory deviceKey as securityToken and registers the device locally with status "unclaimed". ' +
					'The device can start polling hawkBit immediately. No company is assigned until a user claims it via POST /api/companies/:id/devices.',
			},
			response: {
				201: DeviceCreateResponseSchema,
				400: ErrorResponseSchema,
				409: ErrorResponseSchema,
			},
		},
	)

	// GET /api/devices/unclaimed — List devices without a company
	.get(
		'/unclaimed',
		async ({ user, set }) => {
			const devices = await listUnclaimedDevices();
			return { data: devices, total: devices.length };
		},
		{
			auth: true,
			detail: {
				tags: ['Provisioning'],
				summary: 'List unclaimed devices (no company)',
				description:
					'Returns all devices that have been provisioned but not yet claimed by any company. ' +
					'These devices are polling hawkBit but have no company assignment.',
			},
			response: {
				200: DeviceListResponseSchema,
			},
		},
	);
