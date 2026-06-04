import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { user } from './auth';

/**
 * Deployments — local registry linked to hawkBit Distribution Set IDs.
 *
 * Ownership model (same pattern as devices):
 * - Each deployment belongs to exactly one company (companyId FK)
 * - hawkbitDsId maps to the hawkBit Distribution Set ID (UNIQUE)
 * - Write-through: createDeployment creates in hawkBit + inserts here
 * - All reads filter by companyId → tenant isolation
 */
export const deployments = pgTable('deployments', {
	id: uuid('id').primaryKey().defaultRandom(),
	companyId: uuid('company_id')
		.notNull()
		.references(() => companies.id, { onDelete: 'cascade' }),
	/** hawkBit Distribution Set ID — unique across all companies. */
	hawkbitDsId: integer('hawkbit_ds_id').notNull(),
	/** User-visible deployment name. */
	name: text('name').notNull(),
	/** Ninbus artifact type key used in this deployment. */
	artifactType: text('artifact_type').notNull(),
	createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
	uniqueIndex('idx_deployments_hawkbit_ds_id').on(table.hawkbitDsId),
]);

export type Deployment = typeof deployments.$inferSelect;
export type NewDeployment = typeof deployments.$inferInsert;
