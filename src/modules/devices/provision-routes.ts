/**
 * Provisioning routes — factory / warehouse pre-registration.
 *
 * These routes create hawkBit targets BEFORE any company claims the device.
 * Done at the factory or warehouse with serialNumber + deviceKey from the device label.
 * The device starts polling hawkBit immediately but has no company assignment.
 *
 * Role requirements:
 * - POST /provision   → any authenticated user (factory operator)
 * - GET /unclaimed    → any authenticated user (warehouse/inventory view)
 */
import { withAuth } from '@common/middleware/auth-guard';
import {
	DeviceCreateResponseSchema,
	DeviceListResponseSchema,
	ErrorResponseSchema,
	provisionDeviceSchema,
} from '@modules/devices/schemas';
import { Elysia } from 'elysia';
import { provisionDevice, listUnclaimedDevices } from './provisioning';

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
				security: [{ cookieAuth: [] }],
				description:
					'Creates a hawkBit target with the factory deviceKey as securityToken and registers the device locally with status "unclaimed". ' +
					'The device can start polling hawkBit immediately. No company is assigned until a user claims it via POST /api/companies/:id/devices.\n\n' +
					'**Serial number formats accepted:**\n' +
					'- Hex: `255FFFFFFF123456` (same as hawkBit controllerId)\n' +
					'- Dotted: `25.5F.FF.FF.FF.12.34.56` (from device label)\n\n' +
					'The API normalizes to uppercase hex internally. The response includes both `serialNumber` (hex) and `serialDisplay` (dotted).\n\n' +
					'**⚠️ Authentication required:** You must first sign in via `POST /api/auth/sign-in/email` and use the session cookie. ' +
					'This is a platform-level route (no company context needed).',
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
		async () => {
			const devices = await listUnclaimedDevices();
			return { data: devices, total: devices.length };
		},
		{
			auth: true,
			detail: {
				tags: ['Provisioning'],
				security: [{ cookieAuth: [] }],
				summary: 'List unclaimed devices (no company)',
				description:
					'Returns all devices that have been provisioned but not yet claimed by any company.',
			},
			response: {
				200: DeviceListResponseSchema,
			},
		},
	);
