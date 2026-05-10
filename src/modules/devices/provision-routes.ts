/**
 * Provisioning routes — factory / warehouse pre-registration + admin search.
 *
 * These routes create hawkBit targets BEFORE any company claims the device.
 * Done at the factory or warehouse with serialNumber + deviceKey from the device label.
 * The device starts polling hawkBit immediately but has no company assignment.
 *
 * Role requirements:
 * - POST /provision   → any authenticated user (factory operator)
 * - GET /unclaimed    → any authenticated user (warehouse/inventory view)
 * - POST /sync        → admin only (discover auto-provisioned devices)
 * - GET /search       → admin only (search devices by serialNumber)
 */
import { hawkbitConfig } from '@common/config/hawkbit';
import { db } from '@common/db';
import { devices } from '@common/db/schema';
import { withAuth } from '@common/middleware/auth-guard';
import {
	DeviceCreateResponseSchema,
	DeviceListResponseSchema,
	ErrorResponseSchema,
	GenericActionResponseSchema,
	provisionDeviceSchema,
} from '@modules/devices/schemas';
import { Elysia, t } from 'elysia';
import { or, sql } from 'drizzle-orm';
import { provisionDevice, listUnclaimedDevices } from './provisioning';
import { DeviceSyncEngine } from './sync';

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
					'The API normalizes to uppercase hex internally.',
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
	)

	// POST /api/devices/sync — Discover auto-provisioned devices from hawkBit (admin only)
	.post(
		'/sync',
		async ({ user, set }) => {
			// Only admins can trigger sync
			if (!user) {
				set.status = 401;
				return { error: 'Unauthorized', message: 'Please login first' };
			}

			// Check auto-provisioning is enabled
			if (!hawkbitConfig.autoProvisioning) {
				set.status = 400;
				return {
					error: 'Bad Request',
					message:
						'Auto-provisioning is disabled (HAWKBIT_AUTOPROVISIONING=false). ' +
						'Only devices pre-registered via POST /api/devices/provision can connect to hawkBit.',
				};
			}

			try {
				const discovered = await DeviceSyncEngine.discoverAutoProvisioned();
				return {
					message: `Sync complete. ${discovered} new device(s) discovered from hawkBit.`,
					data: { discovered },
				};
			} catch (error: any) {
				set.status = 503;
				return { error: 'Service Unavailable', message: 'hawkBit is not available' };
			}
		},
		{
			auth: true,
			detail: {
				tags: ['Provisioning'],
				security: [{ cookieAuth: [] }],
				summary: 'Sync auto-provisioned devices from hawkBit (admin only)',
				description:
					'Discovers devices that were auto-provisioned by hawkBit (created when a physical device ' +
					'polled for the first time) but do not yet exist in the local database.\n\n' +
					'**Requires HAWKBIT_AUTOPROVISIONING=true.** When auto-provisioning is disabled (production), ' +
					'this endpoint returns 400 — only pre-registered devices can exist.\n\n' +
					'The sync checks all hawkBit targets against the local DB and creates entries for new ones.',
			},
			response: {
				200: GenericActionResponseSchema,
				400: ErrorResponseSchema,
				503: ErrorResponseSchema,
			},
		},
	)

	// GET /api/devices/search?serialNumber=xxx — Admin search across all devices
	.get(
		'/search',
		async ({ query, set }) => {
			if (!query?.serialNumber || query.serialNumber.trim().length === 0) {
				set.status = 400;
				return { error: 'Bad Request', message: 'serialNumber query parameter is required' };
			}

			const search = query.serialNumber.trim().toUpperCase();
			// Also search by dotted display format (dots removed)
			const searchClean = search.replace(/[^0-9A-F]/g, '');

			const results = await db
				.select()
				.from(devices)
				.where(
					or(
						sql`UPPER(${devices.serialNumber}) LIKE ${`%${search}%`}`,
						sql`UPPER(${devices.serialDisplay}) LIKE ${`%${search}%`}`,
						sql`UPPER(${devices.serialNumber}) LIKE ${`%${searchClean}%`}`,
						sql`UPPER(${devices.hawkbitTargetId}) LIKE ${`%${search}%`}`,
					),
				)
				.limit(50);

			return { data: results, total: results.length };
		},
		{
			auth: true,
			query: t.Object({
				serialNumber: t.String({
					minLength: 1,
					maxLength: 255,
					description: 'Serial number to search for (hex or dotted format)',
				}),
			}),
			detail: {
				tags: ['Provisioning'],
				security: [{ cookieAuth: [] }],
				summary: 'Search devices by serialNumber (admin only)',
				description:
					'Searches ALL devices (across all companies, including unclaimed) by serial number. ' +
					'Supports both hex (`2100280018513531`) and dotted (`21.00.28.00.18.51.35.31`) formats. ' +
					'Useful for finding auto-provisioned devices or checking if a device exists.\n\n' +
					'Returns up to 50 results.',
			},
			response: {
				200: DeviceListResponseSchema,
				400: ErrorResponseSchema,
			},
		},
	);
