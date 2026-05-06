import { pgEnum, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { categories } from './categories';
import { companies } from './companies';

/**
 * Ninbus devices — local registry linked to hawkBit target IDs.
 */

export const deviceStatusEnum = pgEnum('device_status', [
	'unclaimed',
	'pending',
	'accepted',
	'rejected',
	'preauthorized',
	'decommissioned',
]);

export const devices = pgTable('devices', {
	id: uuid('id').primaryKey().defaultRandom(),
	companyId: uuid('company_id')
		.references(() => companies.id, { onDelete: 'cascade' }),
	hawkbitTargetId: text('hawkbit_target_id'),
	name: text('name').notNull(),
	serialNumber: text('serial_number'),
	status: deviceStatusEnum('status').notNull().default('pending'),
	lastSeenAt: timestamp('last_seen_at'),
	createdBy: text('created_by')
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
