import { pgEnum, pgTable, primaryKey, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
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

/** hawkBit update status — mirrors hawkBit Target updateStatus field. */
export const hawkbitUpdateStatusEnum = pgEnum('hawkbit_update_status', [
	'unknown',
	'in_sync',
	'pending',
	'registered',
	'error',
]);

export const devices = pgTable('devices', {
	id: uuid('id').primaryKey().defaultRandom(),
	companyId: uuid('company_id')
		.references(() => companies.id, { onDelete: 'cascade' }),
	hawkbitTargetId: text('hawkbit_target_id'),
	name: text('name').notNull(),
	serialNumber: text('serial_number'),
	/** Human-readable dotted format (e.g. "25.5F.FF.FF.FF.FF.FF.FF"). Auto-derived from serialNumber hex. */
	serialDisplay: text('serial_display'),
	status: deviceStatusEnum('status').notNull().default('pending'),
	lastSeenAt: timestamp('last_seen_at'),
	/** hawkBit connection status — derived from pollStatus.overdue. */
	connectionStatus: varchar('connection_status', { length: 20 }).default('unknown'),
	/** hawkBit update status — from target.updateStatus. */
	hawkbitUpdateStatus: hawkbitUpdateStatusEnum('hawkbit_update_status').default('unknown'),
	/** hawkBit IP address — from target.ipAddress. */
	ipAddress: text('ip_address'),
	/** hawkBit last poll time — from target.pollStatus.lastRequestAt. */
	lastPollAt: timestamp('last_poll_at'),
	/** hawkBit next expected poll — from target.pollStatus.nextExpectedRequestAt. */
	nextExpectedPollAt: timestamp('next_expected_poll_at'),
	createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
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
