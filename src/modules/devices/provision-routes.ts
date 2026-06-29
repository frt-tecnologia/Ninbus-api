/**
 * Provisioning routes — factory/warehouse pre-registration + admin management.
 *
 * - POST /provision     → super admin only
 * - GET /unclaimed      → super admin only
 * - POST /sync          → super admin only
 * - GET /search         → super admin only
 * - DELETE /deprovision → super admin only
 */import { hawkbitConfig } from '@common/config/hawkbit';
import { db } from '@common/db';
import { devices } from '@common/db/schema';
import { withAuth } from '@common/middleware/auth-guard';
import { DeviceCreateResponseSchema, DeviceListResponseSchema, ErrorResponseSchema, GenericActionResponseSchema, provisionDeviceSchema } from '@modules/devices/schemas';
import { Elysia, t } from 'elysia';
import { or, sql, eq } from 'drizzle-orm';
import { provisionDevice, listUnclaimedDevices } from './provisioning';
import { DeviceSyncEngine } from './sync';
import { normalizeSerial } from '@common/utils/serial-number';
import { appLogger } from '@common/logger';
import { hawkbitTargets } from '@common/hawkbit/client';

export const provisioningRoutes = withAuth(
	new Elysia({ prefix: '/api/devices' }),
)
	// POST /api/devices/provision — Pre-register device (super admin only)
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
			superAdmin: true,
			body: provisionDeviceSchema,
			detail: {
				tags: ['Provisioning'],
				summary: 'Pre-register device in hawkBit (super admin only)',
				security: [{ cookieAuth: [] }, { bearerAuth: [] }],
				description: 'Creates hawkBit target + local device as "unclaimed". Serial formats: display (26.6.15.001.00031) or HEX (1A61500100031FFF). Month accepts 0-9 and A/B/C. Display is converted to HEX via BCD packing. Super admin only.',
			},
			response: {
				201: DeviceCreateResponseSchema,
				400: ErrorResponseSchema,
				403: ErrorResponseSchema,
				409: ErrorResponseSchema,
			},
		},
	)

	// GET /api/devices/unclaimed — List devices without a company (super admin only)
	.get(
		'/unclaimed',
		async () => {
			const devices = await listUnclaimedDevices();
			return { data: devices, total: devices.length };
		},
		{
			auth: true,
			superAdmin: true,
			detail: {
				tags: ['Provisioning'],
				security: [{ cookieAuth: [] }, { bearerAuth: [] }],
				summary: 'List unclaimed devices (super admin only)',
				description: 'All provisioned devices not yet claimed by any company. Super admin only.',
			},
			response: {
				200: DeviceListResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	)

	// POST /api/devices/sync — Discover auto-provisioned devices (super admin only)
	.post(
		'/sync',
		async ({ set }) => {
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
			superAdmin: true,
			detail: {
				tags: ['Provisioning'],
				security: [{ cookieAuth: [] }, { bearerAuth: [] }],
				summary: 'Sync auto-provisioned devices from hawkBit (super admin only)',
				description:
					'Discovers auto-provisioned hawkBit targets not yet in local DB. ' +
					'Requires HAWKBIT_AUTOPROVISIONING=true. Super admin only.',
			},
			response: {
				200: GenericActionResponseSchema,
				400: ErrorResponseSchema,
				403: ErrorResponseSchema,
				503: ErrorResponseSchema,
			},
		},
	)

	// GET /api/devices/search?serialNumber=xxx — Super admin search
	.get(
		'/search',
		async ({ query, set }) => {
			if (!query?.serialNumber || query.serialNumber.trim().length === 0) {
				set.status = 400;
				return { error: 'Bad Request', message: 'serialNumber query parameter is required' };
			}

			const search = query.serialNumber.trim().toUpperCase();
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
			superAdmin: true,
			query: t.Object({
				serialNumber: t.String({
					minLength: 1,
					maxLength: 255,
					description: 'Serial number to search for (display like 26.6.15.001.00031 or HEX like 1A61500100031FFF)',
				}),
			}),
			detail: {
				tags: ['Provisioning'],
				security: [{ cookieAuth: [] }, { bearerAuth: [] }],
				summary: 'Search devices by serialNumber (super admin only)',
				description:
				'Search ALL devices (all companies + unclaimed) by serial number. ' +
				'Supports display (26.6.15.001.00031) and HEX (1A61500100031FFF) formats. Super admin only. Returns up to 50 results.',
			},
			response: {
				200: DeviceListResponseSchema,
				400: ErrorResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	)

	// DELETE /api/devices/deprovision/:serialNumber — Remove from hawkBit (super admin only)
	.delete(
		'/deprovision/:serialNumber',
		async ({ params, set }) => {
			if (!hawkbitConfig.enabled) {
				set.status = 400;
				return { error: 'Bad Request', message: 'hawkBit integration is disabled' };
			}

			const normalized = normalizeSerial(params.serialNumber);
			if (!normalized) {
				set.status = 400;
				return { error: 'Bad Request', message: 'Invalid serial number format' };
			}

			const serialHex = normalized.hex;

			// Delete from hawkBit
			try {
				await hawkbitTargets.delete(serialHex);
			} catch {
				appLogger.debug('[DEPROVISION] hawkBit target %s not found or already deleted', serialHex);
			}

			// Delete from local DB
			const [deleted] = await db
				.delete(devices)
				.where(eq(devices.serialNumber, serialHex))
				.returning();

			appLogger.info(
				`[DEPROVISION] Device ${serialHex} removed from hawkBit and local DB. ` +
				`${deleted ? 'Local record deleted.' : 'No local record found.'}`,
			);

			return {
				message: `Device ${serialHex} deprovisioned successfully`,
				data: { serialNumber: serialHex, localDeleted: !!deleted },
			};
		},
		{
			auth: true,
			superAdmin: true,
			params: t.Object({
				serialNumber: t.String({
					minLength: 1,
					maxLength: 255,
					description: 'Device serial number — display (26.6.15.001.00031) or HEX (1A61500100031FFF)',
				}),
			}),
			detail: {
				tags: ['Provisioning'],
				security: [{ cookieAuth: [] }, { bearerAuth: [] }],
				summary: 'Deprovision device from hawkBit (super admin only)',
				description:
					'Permanently removes device from hawkBit + local DB. The ONLY way to delete a hawkBit target. ' +
					'Removing from a company (DELETE /companies/:id/devices/:deviceId) only unclaims — target preserved. ' +
					'Super admin only. Deprovisioned devices need re-provisioning via POST /devices/provision.',
			},
			response: {
				200: GenericActionResponseSchema,
				400: ErrorResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	);
