import { activityActionEnum, activityEntityEnum } from '@common/db/schema/observability';
/**
 * Observability module schemas (super-admin endpoints).
 *
 * All timestamp fields use t.Date() — Drizzle returns JS Date objects and
 * t.Date() accepts both Date and ISO strings (per project convention).
 */
import { ErrorResponseSchema, dateTimeString } from '@common/schemas';
import { t } from 'elysia';

// Build literal unions from the Drizzle enum values (single source of truth) so
// invalid action/entityType filters return a clean 400 instead of a Postgres
// enum-cast 500. Auto-stays in sync with the schema — no hardcoded literals.
const ActionLiterals = activityActionEnum.enumValues.map((v) => t.Literal(v));
const EntityLiterals = activityEntityEnum.enumValues.map((v) => t.Literal(v));

// ── Activity log ────────────────────────────────────────────────────────

export const ActivityLogEntrySchema = t.Object({
	id: t.Number(),
	actorUserId: t.Union([t.String(), t.Null()]),
	actorEmail: t.Union([t.String(), t.Null()]),
	companyId: t.Union([t.String({ format: 'uuid' }), t.Null()]),
	action: t.String(),
	entityType: t.String(),
	entityId: t.String(),
	entityLabel: t.Union([t.String(), t.Null()]),
	metadata: t.Record(t.String(), t.Unknown()),
	ipAddress: t.Union([t.String(), t.Null()]),
	createdAt: dateTimeString,
});

export const ActivityListResponseSchema = t.Object({
	data: t.Array(ActivityLogEntrySchema),
	total: t.Number(),
	hasMore: t.Boolean(),
});

export const ActivityQuerySchema = t.Object({
	companyId: t.Optional(t.String({ format: 'uuid' })),
	entityType: t.Optional(t.Union(EntityLiterals)),
	action: t.Optional(t.Union(ActionLiterals)),
	actorUserId: t.Optional(t.String()),
	from: t.Optional(t.Date()),
	to: t.Optional(t.Date()),
	limit: t.Optional(t.Number({ minimum: 1, maximum: 200 })),
	before: t.Optional(t.Number()),
});

// ── Device connections (sessions / aggregate) ──────────────────────────

export const SessionBandSchema = t.Object({
	deviceId: t.String({ format: 'uuid' }),
	hawkbitTargetId: t.Union([t.String(), t.Null()]),
	deviceName: t.Union([t.String(), t.Null()]),
	start: dateTimeString,
	end: dateTimeString,
	ipAddress: t.Union([t.String(), t.Null()]),
});

export const AggregateBucketSchema = t.Object({
	bucket: dateTimeString,
	onlineCount: t.Number(),
});

export const ConnectionsQuerySchema = t.Object({
	companyId: t.Optional(t.String({ format: 'uuid' })),
	deviceId: t.Optional(t.String({ format: 'uuid' })),
	from: t.Date(),
	to: t.Date(),
	view: t.Optional(t.Union([t.Literal('session'), t.Literal('aggregate'), t.Literal('auto')])),
});

/**
 * Company-scoped device connection timeline (member-facing device reports).
 * `from`/`to` are optional (default: last 24h). Capped at OBS_CONNECTIONS_RETENTION_DAYS.
 */
export const CompanyConnectionsQuerySchema = t.Object({
	from: t.Optional(t.Date({ description: 'ISO 8601. Defaults to now - 24h.' })),
	to: t.Optional(t.Date({ description: 'ISO 8601. Defaults to now.' })),
	deviceId: t.Optional(t.String({ format: 'uuid', description: 'Filter a single device.' })),
});

export const ConnectionEventSchema = t.Object({
	deviceId: t.String({ format: 'uuid' }),
	deviceName: t.Union([t.String(), t.Null()]),
	hawkbitTargetId: t.Union([t.String(), t.Null()]),
	event: t.Union([t.Literal('online'), t.Literal('offline')]),
	occurredAt: dateTimeString,
	ipAddress: t.Union([t.String(), t.Null()]),
});

export const CompanyConnectionsResponseSchema = t.Object({
	range: t.Object({ from: dateTimeString, to: dateTimeString }),
	data: t.Array(ConnectionEventSchema),
	total: t.Number(),
});

export const SessionsResponseSchema = t.Object({
	view: t.String(),
	range: t.Object({ from: dateTimeString, to: dateTimeString }),
	data: t.Array(t.Union([SessionBandSchema, AggregateBucketSchema])),
	total: t.Number(),
});

// ── Aggregated categories ──────────────────────────────────────────────

export const AggregatedCategorySchema = t.Object({
	id: t.String({ format: 'uuid' }),
	companyId: t.String({ format: 'uuid' }),
	companyName: t.Union([t.String(), t.Null()]),
	name: t.String(),
	type: t.String(),
	description: t.Union([t.String(), t.Null()]),
	deviceCount: t.Number(),
	createdAt: dateTimeString,
});

export const AggregatedCategoryListResponseSchema = t.Object({
	data: t.Array(AggregatedCategorySchema),
	total: t.Number(),
});

export const CategoryAggregateQuerySchema = t.Object({
	companyId: t.Optional(t.String({ format: 'uuid' })),
	type: t.Optional(
		t.Union(
			[
				t.Literal('bus_line'),
				t.Literal('garage'),
				t.Literal('yard'),
				t.Literal('region'),
				t.Literal('custom'),
			],
			{
				description:
					'Category type filter. Must be one of: bus_line, garage, yard, region, custom. ' +
					'An invalid value returns 400 (avoids a Postgres enum cast error).',
			},
		),
	),
});

export { ErrorResponseSchema };

// ── Platform stats (overview) ─────────────────────────────────────────

export const PlatformStatsResponseSchema = t.Object({
	range: t.Object({ from: dateTimeString, to: dateTimeString }),
	onlineHistogram: t.Array(t.Object({ date: t.String(), online: t.Number() })),
	deploymentCreated: t.Number(),
	deploymentDeleted: t.Number(),
	artifactUploaded: t.Number(),
	topCompanies: t.Array(
		t.Object({
			companyId: t.String(),
			companyName: t.Union([t.String(), t.Null()]),
			actions: t.Number(),
		}),
	),
	updateHourDistribution: t.Array(t.Object({ hour: t.Number(), count: t.Number() })),
	newUserDesignations: t.Number(),
	onlineDevices: t.Number(),
});

export const StatsQuerySchema = t.Object({
	from: t.Optional(t.Date()),
	to: t.Optional(t.Date()),
});
