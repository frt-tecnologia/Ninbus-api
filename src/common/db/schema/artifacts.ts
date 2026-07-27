import { sql } from 'drizzle-orm';
import {
	check,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { categories } from './categories';
import { companies } from './companies';

/**
 * Artifacts — local registry linked to hawkBit Software Module IDs.
 *
 * Ownership model (same pattern as devices):
 * - Each artifact belongs to exactly one company (companyId FK)
 * - hawkbitSmId maps to the hawkBit Software Module ID (UNIQUE)
 * - Write-through: upload creates in hawkBit + inserts here
 * - All reads filter by companyId → tenant isolation
 */
export const artifacts = pgTable(
	'artifacts',
	{
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
	},
	(table) => [
		uniqueIndex('idx_artifacts_hawkbit_sm_id').on(table.hawkbitSmId),
		// Defense-in-depth: the API schema caps description at 1000 chars; enforce at the DB too.
		check(
			'artifacts_description_length_check',
			sql`${table.description} IS NULL OR char_length(${table.description}) <= 1000`,
		),
	],
);

export type Artifact = typeof artifacts.$inferSelect;
export type NewArtifact = typeof artifacts.$inferInsert;

/**
 * Artifact ↔ Category assignments (N:N) — mirrors device_category_assignments.
 * Groups are LOCAL ONLY (hawkBit has no Software Module grouping). Both FKs cascade:
 * deleting an artifact or a category cleans up assignments automatically.
 */
export const artifactCategoryAssignments = pgTable(
	'artifact_category_assignments',
	{
		artifactId: uuid('artifact_id')
			.notNull()
			.references(() => artifacts.id, { onDelete: 'cascade' }),
		categoryId: uuid('category_id')
			.notNull()
			.references(() => categories.id, { onDelete: 'cascade' }),
		assignedAt: timestamp('assigned_at').notNull().defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.artifactId, table.categoryId] }),
		// Reverse lookup: "which artifacts belong to category X".
		index('idx_artifact_category_category').on(table.categoryId),
	],
);
export type ArtifactCategoryAssignment = typeof artifactCategoryAssignments.$inferSelect;
