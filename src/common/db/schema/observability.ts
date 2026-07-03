import {
	bigserial,
	index,
	inet,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { companies } from './companies';
import { devices } from './devices';

/**
 * Observability & audit tables (super-admin dashboard).
 *
 * Telemetry model = TRANSITION EVENTS ONLY:
 * `device_connections` records a row exclusively on a connection state change
 * (online↔offline), never on every hawkBit poll. Steady-state devices produce
 * ZERO writes per sync cycle. This keeps storage + write-CPU minimal at scale
 * while preserving full observability (when each session started/ended).
 *
 * Both tables are append-only. `activity_log` never expires (audit).
 * `device_connections` retention is a batched DELETE job (configurable, G-phase).
 */

// ── Enums ───────────────────────────────────────────────────────────────

export const activityActionEnum = pgEnum('activity_action', [
	'company.created',
	'company.updated',
	'company.deleted',
	'company.suspended',
	'company.activated',
	'category.created',
	'category.updated',
	'category.deleted',
	'member.added',
	'member.role_changed',
	'member.removed',
	'designation.created',
	'designation.cancelled',
	'designation.claimed',
	'device.provisioned',
	'device.claimed',
	'device.unclaimed',
	'device.deprovisioned',
	'device.renamed',
	'device.category_changed',
	'deployment.created',
	'deployment.deleted',
	'artifact.uploaded',
	'artifact.deleted',
]);

export const activityEntityEnum = pgEnum('activity_entity', [
	'company',
	'category',
	'device',
	'deployment',
	'artifact',
	'member',
	'designation',
	'user',
]);

export const connectionEventEnum = pgEnum('connection_event', ['online', 'offline']);

// ── activity_log (append-only audit feed) ───────────────────────────────

export const activityLog = pgTable(
	'activity_log',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
		/** Snapshot of the actor's email — survives user deletion (it's an audit log). */
		actorEmail: text('actor_email'),
		companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
		action: activityActionEnum('action').notNull(),
		entityType: activityEntityEnum('entity_type').notNull(),
		/** Entity id as text — accommodates both UUID and integer (deployment dsId) ids. */
		entityId: text('entity_id').notNull(),
		/** Human-readable snapshot (name/serial) — survives entity deletion. */
		entityLabel: text('entity_label'),
		/** Variable extras only (role, from→to, counts). jsonb compresses large values (TOAST). */
		metadata: jsonb('metadata').notNull().default({}),
		ipAddress: inet('ip_address'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index('idx_activity_log_company_created').on(table.companyId, table.createdAt),
		index('idx_activity_log_entity_created').on(table.entityType, table.createdAt),
		index('idx_activity_log_actor').on(table.actorUserId),
	],
);

// ── device_connections (transition-event telemetry) ─────────────────────

export const deviceConnections = pgTable(
	'device_connections',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		deviceId: uuid('device_id')
			.notNull()
			.references(() => devices.id, { onDelete: 'cascade' }),
		companyId: uuid('company_id')
			.notNull()
			.references(() => companies.id, { onDelete: 'cascade' }),
		/** hawkBit controllerId snapshot (survives target id change). */
		hawkbitTargetId: text('hawkbit_target_id'),
		/** Device name snapshot (survives rename). */
		deviceName: text('device_name'),
		/** 'online' | 'offline' — recorded ONLY on a real state change. */
		event: connectionEventEnum('event').notNull(),
		occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
		ipAddress: inet('ip_address'),
		recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index('idx_device_connections_company_occurred').on(table.companyId, table.occurredAt),
		index('idx_device_connections_device_occurred').on(table.deviceId, table.occurredAt),
	],
);

export type ActivityLog = typeof activityLog.$inferSelect;
export type NewActivityLog = typeof activityLog.$inferInsert;
export type DeviceConnection = typeof deviceConnections.$inferSelect;
export type NewDeviceConnection = typeof deviceConnections.$inferInsert;

export type ActivityAction = (typeof activityActionEnum.enumValues)[number];
export type ActivityEntity = (typeof activityEntityEnum.enumValues)[number];
export type ConnectionEvent = (typeof connectionEventEnum.enumValues)[number];
