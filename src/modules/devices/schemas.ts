import { devices } from '@common/db/schema';
import {
	ErrorResponseSchema,
	GenericActionResponseSchema,
	dateTimeString,
	nullableDateTimeString,
} from '@common/schemas';
import { createSelectSchema } from 'drizzle-typebox';
import { t } from 'elysia';

export const provisionDeviceSchema = t.Object(
	{
		serialNumber: t.String({
			minLength: 1,
			maxLength: 255,
			description:
				'Device serial number. Accepts hex format (255FFFFFFFFFFFF) or dotted display format (25.5F.FF.FF.FF.FF.FF.FF). ' +
				'Must be exactly 16 hex chars (8 bytes from EEPROM). Stored as uppercase hex — same as hawkBit controllerId. ' +
				'If all EEPROM bytes are 0xFF, firmware falls back to STM32 UID (also 16 hex chars).',
		}),
		deviceKey: t.String({
			minLength: 8,
			maxLength: 256,
			description:
				'Factory security token (TargetToken). Set as the hawkBit target securityToken so the device ' +
				'can authenticate via DDI header: Authorization: TargetToken {deviceKey}.',
		}),
		name: t.Optional(
			t.String({
				maxLength: 255,
				description: 'Optional display name. Defaults to dotted serial format (e.g. 25.5F.FF.FF.FF.FF.FF.FF) if not provided.',
			}),
		),
	},
	{
		default: {
			serialNumber: '255FFFFFFFFFFFF',
			deviceKey: 'factory-device-key-from-label',
			name: 'Ninbus-veiculo-06',
		},
	},
);

export const registerDeviceSchema = t.Object(
	{
		name: t.Optional(t.String({ minLength: 1, maxLength: 255, description: 'Display name for the device' })),
		serialNumber: t.String({
			minLength: 1,
			maxLength: 255,
			description:
				'Device serial number. Accepts hex (255FFFFFFFFFFFF) or dotted format (25.5F.FF.FF.FF.FF.FF.FF). ' +
				'Used to match with a pre-provisioned device in hawkBit.',
		}),
	},
	{ default: { serialNumber: '255FFFFFFFFFFFF' } },
);

export const linkDeviceSchema = t.Object(
	{
		deviceKey: t.String({
			minLength: 8,
			maxLength: 256,
			description:
				'Device security token (factory key). Creates the hawkBit target and links this device.',
		}),
	},
	{
		default: {
			deviceKey: 'factory-device-key-from-label',
		},
	},
);

export const updateDeviceSchema = t.Object(
	{
		name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
		serialNumber: t.Optional(t.String({ maxLength: 255 })),
	},
	{ default: { name: 'Dispositivo Principal 01 (Atualizado)', serialNumber: '255FFFFFFFFFFFF' } },
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
	lastPollAt: nullableDateTimeString,
	nextExpectedPollAt: nullableDateTimeString,
});

export const LinkDeviceResponseSchema = t.Object({
	message: t.String(),
	data: selectDeviceSchema,
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
