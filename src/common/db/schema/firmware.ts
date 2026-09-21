import { sql } from 'drizzle-orm';
import {
	check,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';

/**
 * Release lifecycle gate — the factory test layer.
 *
 * - draft: uploaded, NOT visible to end users (no `update_available` on
 *   mobile status, cannot be applied via the opt-in trigger). Only the
 *   admin console can push it (force deploy with an explicit releaseId)
 *   so the factory can validate it on pilot devices first.
 * - published: available to every company — the mobile status endpoint
 *   and the opt-in trigger resolve it as the latest release.
 */
export const firmwareReleaseStatus = pgEnum('firmware_release_status', ['draft', 'published']);

export const firmwareReleases = pgTable(
	'firmware_releases',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		/** hawkBit Software Module ID — unique across the platform. */
		hawkbitSmId: integer('hawkbit_sm_id').notNull(),
		/** User-visible display name (e.g. "wifi3 — estabilidade CAN"). */
		name: text('name').notNull(),
		/** Semantic version tag of the release (e.g. "4.0.1") — REQUIRED. */
		version: text('version').notNull(),
		/** Firmware type: firmware-ninbus (self-update) | firmware-controller (CAN). */
		artifactType: text('artifact_type').notNull(),
		/** Release gate: draft (factory testing) | published (available to users). */
		status: firmwareReleaseStatus('status').notNull().default('draft'),
		description: text('description'),
		/** Original uploaded filename (.fir, .frz, .bin, etc.). */
		originalFilename: text('original_filename'),
		/** Original firmware file size in bytes (before tar packaging). */
		payloadSize: integer('payload_size'),
		/** Total .tar archive size uploaded to hawkBit. */
		packageSize: integer('package_size'),
		/** Anti-downgrade manifest counter (firmware-ninbus only, from the NPM
		 *  manifest). Drives the automatic nextCounter = max+1 policy — releases
		 *  created before this column are treated as 0. */
		counter: integer('counter'),
		/** NPM manifest v2 packed version u32 (major<<24|minor<<16|patch<<8|build).
		 * NULL = v1 legacy manifest (no version-piso) or non-ninbus type. */
		manifestVersion: integer('manifest_version'),
		/** NPM manifest v2 flags (bit0 = allow_downgrade). NULL = v1/non-ninbus. */
		manifestFlags: integer('manifest_flags'),
		/** Pre-publish verification gate evidence (checks, verdict, sha256,
		 * fleet floor) — required before status='published' for v2 releases. */
		gate: jsonb('gate'),
		/** When the publication gate last ran and passed. */
		gateAt: timestamp('gate_at', { withTimezone: true }),
		createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex('idx_firmware_releases_hawkbit_sm_id').on(table.hawkbitSmId),
		uniqueIndex('idx_firmware_releases_type_version').on(table.artifactType, table.version),
		index('idx_firmware_releases_type_created').on(table.artifactType, table.createdAt),
		// Defense-in-depth: the API schema caps description at 1000 chars.
		check(
			'firmware_releases_description_length_check',
			sql`${table.description} IS NULL OR char_length(${table.description}) <= 1000`,
		),
	],
);

export type FirmwareRelease = typeof firmwareReleases.$inferSelect;
export type NewFirmwareRelease = typeof firmwareReleases.$inferInsert;
