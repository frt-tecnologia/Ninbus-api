import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { user } from './auth';

/**
 * Artifacts — local registry linked to hawkBit Software Module IDs.
 *
 * Ownership model (same pattern as devices):
 * - Each artifact belongs to exactly one company (companyId FK)
 * - hawkbitSmId maps to the hawkBit Software Module ID (UNIQUE)
 * - Write-through: upload creates in hawkBit + inserts here
 * - All reads filter by companyId → tenant isolation
 */
export const artifacts = pgTable('artifacts', {
	id: uuid('id').primaryKey().defaultRandom(),
	companyId: uuid('company_id')
		.notNull()
		.references(() => companies.id, { onDelete: 'cascade' }),
	/** hawkBit Software Module ID — unique across all companies. */
	hawkbitSmId: integer('hawkbit_sm_id').notNull(),
	/** User-visible display name (artifactName from upload). */
	name: text('name').notNull(),
	/** Ninbus artifact type key (firmware-ninbus, firmware-controller, configuration-nfx). */
	artifactType: text('artifact_type').notNull(),
	version: text('version').notNull().default('1.0'),
	description: text('description'),
	/** Original uploaded filename (.fir, .frz, .bin, etc.). */
	originalFilename: text('original_filename'),
	/** Original firmware file size in bytes (before tar packaging). */
	payloadSize: integer('payload_size'),
	/** Total .tar archive size uploaded to hawkBit. */
	packageSize: integer('package_size'),
	createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
	uniqueIndex('idx_artifacts_hawkbit_sm_id').on(table.hawkbitSmId),
]);

export type Artifact = typeof artifacts.$inferSelect;
export type NewArtifact = typeof artifacts.$inferInsert;
