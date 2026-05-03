import { pgEnum, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { categories } from './categories';
import { companies } from './companies';

/**
 * Ninbus devices — local registry linked to Mender device IDs.
 * device_category_assignments provides N:N with categories.
 */

export const deviceStatusEnum = pgEnum('device_status', [
	'pending',
	'accepted',
	'rejected',
	'preauthorized',
	'decommissioned',
]);

export const devices = pgTable('devices', {
	id: uuid('id').primaryKey().defaultRandom(),
	companyId: uuid('company_id')
		.notNull()
		.references(() => companies.id, { onDelete: 'cascade' }),
	menderDeviceId: text('mender_device_id'),
	name: text('name').notNull(),
	serialNumber: text('serial_number'),
	status: deviceStatusEnum('status').notNull().default('pending'),
	lastSeenAt: timestamp('last_seen_at'),
	createdBy: text('created_by')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const deviceCategoryAssignments = pgTable(
	'device_category_assignments',
	{
		deviceId: uuid('device_id')
			.notNull()
			.references(() => devices.id, { onDelete: 'cascade' }),
		categoryId: uuid('category_id')
			.notNull()
			.references(() => categories.id, { onDelete: 'cascade' }),
		assignedAt: timestamp('assigned_at').notNull().defaultNow(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.deviceId, table.categoryId] }),
	}),
);

export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;
export type DeviceCategoryAssignment = typeof deviceCategoryAssignments.$inferSelect;
