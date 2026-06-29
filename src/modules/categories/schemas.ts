import { categories, devices } from '@common/db/schema';
import type { deviceCategoryAssignments } from '@common/db/schema';
import { ErrorResponseSchema, GenericActionResponseSchema, dateTimeString, nullableDateTimeString } from '@common/schemas';
import { createSelectSchema } from 'drizzle-typebox';
import { t } from 'elysia';

/**
 * Re-export common response schemas so route files import everything from here.
 */
export { ErrorResponseSchema, GenericActionResponseSchema };

export const createCategorySchema = t.Object(
	{
		name: t.String({ minLength: 1, maxLength: 255, description: 'Category name' }),
		type: t.Union(
			[
				t.Literal('bus_line'),
				t.Literal('garage'),
				t.Literal('yard'),
				t.Literal('region'),
				t.Literal('custom'),
			],
			{ description: 'Category type' },
		),
		description: t.Optional(t.String({ maxLength: 1000, description: 'Category description' })),
	},
	{
		default: {
			name: 'Linha Azul 101',
			type: 'bus_line',
			description: 'Veículos designados para a rota azul',
		},
	},
);

export const updateCategorySchema = t.Object(
	{
		name: t.Optional(t.String({ minLength: 1, maxLength: 255, description: 'Updated name' })),
		description: t.Optional(t.String({ maxLength: 1000, description: 'Updated description' })),
	},
	{
		default: {
			name: 'Linha Azul 101 (Atualizada)',
			description: 'Nova descrição da linha',
		},
	},
);

export const selectCategorySchema = createSelectSchema(categories, {
	createdAt: dateTimeString,
	updatedAt: dateTimeString,
});

export const CategoryResponseSchema = t.Object({
	data: selectCategorySchema,
});

export const CategoryListResponseSchema = t.Object({
	data: t.Array(selectCategorySchema),
});

export const CategoryCreateResponseSchema = t.Object({
	message: t.String(),
	data: selectCategorySchema,
});

export const CategoryUpdateResponseSchema = t.Object({
	message: t.String(),
	data: selectCategorySchema,
});

export const CategoryDeleteResponseSchema = t.Object({
	message: t.String(),
});

// ---------------------------------------------------------------------------
// Category members (devices) — N:N device↔category assignments
// ---------------------------------------------------------------------------

/** Body schema for adding/replacing category members (POST/PUT bulk). */
export const addDevicesToCategorySchema = t.Object(
	{
		deviceIds: t.Array(t.String({ format: 'uuid' }), {
			minItems: 1,
			description: 'Device IDs to assign to this category. Must belong to the same company.',
		}),
	},
	{
		default: {
			deviceIds: ['123e4567-e89b-12d3-a456-426614174000'],
		},
	},
);

/** Device shape as returned by category members endpoints (with assignment metadata). */
const selectMemberDeviceSchema = t.Object({
	id: t.String({ format: 'uuid' }),
	companyId: t.Union([t.String({ format: 'uuid' }), t.Null()]),
	hawkbitTargetId: t.Union([t.String(), t.Null()]),
	name: t.String(),
	serialNumber: t.Union([t.String(), t.Null()]),
	serialDisplay: t.Union([t.String(), t.Null()]),
	status: t.String(),
	connectionStatus: t.Union([t.String(), t.Null()]),
	hawkbitUpdateStatus: t.Union([t.String(), t.Null()]),
	ipAddress: t.Union([t.String(), t.Null()]),
	lastSeenAt: t.Union([dateTimeString, t.Null()]),
	lastPollAt: t.Union([dateTimeString, t.Null()]),
	nextExpectedPollAt: t.Union([dateTimeString, t.Null()]),
	createdAt: dateTimeString,
	updatedAt: dateTimeString,
	/** When the device was added to this category. */
	assignedAt: dateTimeString,
});

export const CategoryDevicesListResponseSchema = t.Object({
	data: t.Array(selectMemberDeviceSchema),
	total: t.Number(),
});

export const CategoryDevicesActionResponseSchema = t.Object({
	message: t.String(),
	data: t.Object({
		assigned: t.Number({ description: 'Number of new assignments created' }),
		skipped: t.Number({ description: 'Number of devices already in this category (idempotent)' }),
		total: t.Number({ description: 'Total members after operation' }),
	}),
});

export const CategoryDeviceRemoveResponseSchema = t.Object({
	message: t.String(),
	data: t.Object({
		removed: t.Number({ description: '1 if removed, 0 if not a member' }),
	}),
});

// Select schema (kept for completeness / other uses)
export const selectDeviceSchema = createSelectSchema(devices, {
	createdAt: dateTimeString,
	updatedAt: dateTimeString,
	lastSeenAt: nullableDateTimeString,
	lastPollAt: nullableDateTimeString,
	nextExpectedPollAt: nullableDateTimeString,
});

// Re-export assignment select schema for consumers
export type DeviceCategoryAssignment = typeof deviceCategoryAssignments.$inferSelect;
