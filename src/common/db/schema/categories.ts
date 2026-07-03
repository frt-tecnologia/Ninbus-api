import { pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { companies } from './companies';

/**
 * Device categories — grouping layer for fleet management.
 * Supports: bus lines, garages, yards, operational regions, custom.
 * Devices can belong to N categories (N:N via device_category_assignments).
 */

export const categoryTypeEnum = pgEnum('category_type', [
	'bus_line',
	'garage',
	'yard',
	'region',
	'custom',
]);

export const categories = pgTable('categories', {
	id: uuid('id').primaryKey().defaultRandom(),
	companyId: uuid('company_id')
		.notNull()
		.references(() => companies.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	type: categoryTypeEnum('type').notNull(),
	description: text('description'),
	/** Audit: who created this category. Nullable for pre-existing rows. */
	createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
