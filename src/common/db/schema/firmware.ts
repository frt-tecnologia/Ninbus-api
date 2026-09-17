import { sql } from 'drizzle-orm';
import {
	check,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';

/**
 * Firmware Releases — factory-managed GLOBAL firmware catalog.
 *
 * Unlike `artifacts` (company-scoped, uploaded by operators for their own
 * deployments), firmware releases are published by the FACTORY (super admin)
 * and are visible platform-wide. They define what "latest firmware version"
 * means for every device: the mobile app compares each device's reported
 * firmware version (DDI attributes, see `devices.firmwareVersion`) against
 * the latest release of each type to decide who needs an update.
 *
 * Ownership model:
 * - NO companyId — the catalog is global by design (factory publishes once,
 *   every company updates against it).
 * - hawkbitSmId maps to the hawkBit Software Module ID (UNIQUE) — the same
 *   write-through pattern as `artifacts`, minus the tenant filter.
 * - UNIQUE (artifactType, version): one release per version tag per type, so
 *   "latest" is never ambiguous.
 */
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
		description: text('description'),
		/** Original uploaded filename (.fir, .frz, .bin, etc.). */
		originalFilename: text('original_filename'),
		/** Original firmware file size in bytes (before tar packaging). */
		payloadSize: integer('payload_size'),
		/** Total .tar archive size uploaded to hawkBit. */
		packageSize: integer('package_size'),
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
