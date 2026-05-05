import { devices } from '@common/db/schema';
import {
	ErrorResponseSchema,
	GenericActionResponseSchema,
	dateTimeString,
	nullableDateTimeString,
} from '@common/schemas';
import { createSelectSchema } from 'drizzle-typebox';
import { t } from 'elysia';

export const registerDeviceSchema = t.Object(
	{
		name: t.String({ minLength: 1, maxLength: 255, description: 'Display name for the device' }),
		serialNumber: t.Optional(t.String({ maxLength: 255, description: 'Device serial number' })),
		hawkbitTargetId: t.Optional(
			t.String({
				description: 'hawkBit target controllerId (if already registered in hawkBit)',
			}),
		),
	},
	{
		default: { name: 'Dispositivo Principal 01', serialNumber: 'SN-987654321' },
	},
);

export const updateDeviceSchema = t.Object(
	{
		name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
		serialNumber: t.Optional(t.String({ maxLength: 255 })),
	},
	{ default: { name: 'Dispositivo Principal 01 (Atualizado)', serialNumber: 'SN-987654321-B' } },
);

export const assignCategoriesSchema = t.Object(
	{
		categoryIds: t.Array(t.String({ format: 'uuid' }), {
			minItems: 1,
			description: 'Category IDs to assign',
		}),
	},
	{ default: { categoryIds: ['123e4567-e89b-12d3-a456-426614174000'] } },
);

export const selectDeviceSchema = createSelectSchema(devices, {
	createdAt: dateTimeString,
	updatedAt: dateTimeString,
	lastSeenAt: nullableDateTimeString,
});

export const DeviceResponseSchema = t.Object({ data: selectDeviceSchema });
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
export const DeviceDeleteResponseSchema = t.Object({ message: t.String() });

// hawkBit response schemas
export const HawkbitAttributesResponseSchema = t.Object({
	data: t.Record(t.String(), t.String()),
});

export const HawkbitActionsResponseSchema = t.Object({
	data: t.Array(
		t.Object({
			id: t.Number(),
			type: t.String(),
			active: t.Boolean(),
			status: t.Optional(t.String()),
			forceType: t.Optional(t.String()),
		}),
	),
});

export { ErrorResponseSchema, GenericActionResponseSchema };
