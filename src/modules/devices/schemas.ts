import { devices } from '@common/db/schema';
import { dateTimeString, nullableDateTimeString, ErrorResponseSchema, GenericActionResponseSchema } from '@common/schemas';
import { createSelectSchema } from 'drizzle-typebox';
import { t } from 'elysia';

export const registerDeviceSchema = t.Object(
	{
		name: t.String({ minLength: 1, maxLength: 255, description: 'Display name for the device' }),
		serialNumber: t.Optional(t.String({ maxLength: 255, description: 'Device serial number' })),
		menderDeviceId: t.Optional(
			t.String({ description: 'Existing Mender device ID (if already registered in Mender)' }),
		),
	},
	{
		default: {
			name: 'Dispositivo Principal 01',
			serialNumber: 'SN-987654321',
		},
	},
);

export const updateDeviceSchema = t.Object(
	{
		name: t.Optional(
			t.String({ minLength: 1, maxLength: 255, description: 'Updated display name' }),
		),
		serialNumber: t.Optional(t.String({ maxLength: 255, description: 'Updated serial number' })),
	},
	{
		default: {
			name: 'Dispositivo Principal 01 (Atualizado)',
			serialNumber: 'SN-987654321-B',
		},
	},
);

export const assignCategoriesSchema = t.Object(
	{
		categoryIds: t.Array(t.String({ format: 'uuid', description: 'Category IDs to assign' }), {
			minItems: 1,
			description: 'List of category IDs to assign to this device',
		}),
	},
	{
		default: {
			categoryIds: ['123e4567-e89b-12d3-a456-426614174000'],
		},
	},
);

export const MenderAuthActionSchema = t.Object(
	{
		authId: t.String({ minLength: 1, description: 'Mender auth set ID to approve/reject' }),
	},
	{
		default: {
			authId: 'auth-id-exemplo',
		},
	},
);

export const createDeploymentSchema = t.Object({
	name: t.String({ minLength: 1, maxLength: 255, description: 'Deployment name' }),
	artifactName: t.String({ minLength: 1, description: 'Artifact name to deploy' }),
	deviceIds: t.Optional(
		t.Array(t.String({ format: 'uuid' }), {
			description: 'Specific device IDs (company devices) to deploy to',
		}),
	),
	categoryIds: t.Optional(
		t.Array(t.String({ format: 'uuid' }), {
			description: 'Deploy to all devices in these categories',
		}),
	),
	allDevices: t.Optional(
		t.Boolean({
			description: 'Deploy to all devices in the company',
		}),
	),
	retries: t.Optional(
		t.Number({ minimum: 0, maximum: 10, description: 'Number of retries on failure' }),
	),
});

export const selectDeviceSchema = createSelectSchema(devices, {
	createdAt: dateTimeString,
	updatedAt: dateTimeString,
	lastSeenAt: nullableDateTimeString,
});

export const DeviceResponseSchema = t.Object({
	data: selectDeviceSchema,
});

export const DeviceListResponseSchema = t.Object({
	data: t.Array(selectDeviceSchema),
	total: t.Number(),
});

export const DeviceCreateResponseSchema = t.Object({
	message: t.String(),
	data: selectDeviceSchema,
});

export const DeviceUpdateResponseSchema = t.Object({
	message: t.String(),
	data: selectDeviceSchema,
});

export const DeviceDeleteResponseSchema = t.Object({
	message: t.String(),
});

export const MenderInventorySchema = t.Array(
	t.Object({
		name: t.String(),
		value: t.Any(),
	}),
);

export const MenderAuthSetSchema = t.Object({
	id: t.String(),
	identity_data: t.Any(),
	pubkey: t.String(),
	status: t.String(),
});

export const MenderDeviceResponseSchema = t.Object({
	data: t.Object({
		id: t.String(),
		attributes: t.Optional(t.Array(t.Any())),
		status: t.String(),
		created_ts: t.Optional(t.String()),
		updated_ts: t.Optional(t.String()),
		auth_sets: t.Optional(t.Array(MenderAuthSetSchema)),
	}),
});

export const MenderInventoryResponseSchema = t.Object({
	data: MenderInventorySchema,
});

export { ErrorResponseSchema, GenericActionResponseSchema };
