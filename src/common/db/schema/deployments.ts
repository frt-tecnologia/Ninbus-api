import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { companies } from './companies';

/**
 * Deployments — local registry linked to hawkBit Distribution Set IDs.
 *
 * Ownership model (same pattern as devices):
 * - Each deployment belongs to exactly one company (companyId FK)
 * - hawkbitDsId maps to the hawkBit Distribution Set ID (UNIQUE)
 * - Write-through: createDeployment creates in hawkBit + inserts here
 * - All reads filter by companyId → tenant isolation
 */
export const deployments = pgTable(
	'deployments',
	{
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
		/** Audit: artifact display name at deployment time. */
		artifactName: text('artifact_name'),
		/** Audit: artifact version at deployment time. */
		artifactVersion: text('artifact_version'),
		/** Audit: original uploaded filename (e.g. "firmware-v3.fir"). */
		artifactOriginalFile: text('artifact_original_file'),
		/** Audit: number of targets assigned. */
		targetCount: integer('target_count').default(0),
		/** Audit: JSON array of hawkBit target IDs assigned (controllerIds). */
		targetIds: text('target_ids'),
		/**
		 * Per-target status snapshot (JSONB). Frozen when a target reaches a terminal
		 * state (finished/canceled) or when its action is superseded by a newer DS.
		 *
		 * This is the NINBUS CANONICAL HISTORY. hawkBit does NOT preserve per-target
		 * status once an action is cancelled/superseded — the action disappears from
		 * `GET /targets/{id}/actions?q=distributionSet.id=={dsId}`. Without this
		 * snapshot, deployments that had devices cancelled by a concurrent deployment
		 * lose their history (devices disappear from the list).
		 *
		 * Shape: { [controllerId]: { phase, actionId, actionType, finalStatus, frozen, snapshotAt } }
		 *
		 * STICKY RULE: once a target's phase is 'installed' (finished), it is NEVER
		 * overwritten — even by a cancellation. This preserves the tracking that the
		 * device DID update successfully before the deployment was cancelled.
		 */
		targetStatusSnapshot: jsonb('target_status_snapshot').default({}),
		createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [uniqueIndex('idx_deployments_hawkbit_ds_id').on(table.hawkbitDsId)],
);

export type Deployment = typeof deployments.$inferSelect;
export type NewDeployment = typeof deployments.$inferInsert;
