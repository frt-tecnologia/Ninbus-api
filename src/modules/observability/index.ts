/**
 * Observability Module — super-admin endpoints for the dashboard.
 *
 * ALL routes require platform super admin access (`superAdmin: true`). These
 * power the company-observability page: activity feed, device connection
 * timeline, and cross-company category aggregation.
 *
 * Endpoints (prefix /api/admin):
 *   GET /activity               — audit feed (cursor-paginated, filterable)
 *   GET /devices/connections    — session bands or aggregate buckets
 *   GET /categories             — cross-company categories with device counts
 */
import { withAuth } from '@common/middleware/auth-guard';
import { listActivity } from '@modules/observability/activity-service';
import { listAggregatedCategories } from '@modules/observability/category-aggregate-service';
import {
	aggregateOnlineEvents,
	countEventsInRange,
	listSessions,
} from '@modules/observability/connections-service';
import {
	ActivityListResponseSchema,
	ActivityQuerySchema,
	AggregatedCategoryListResponseSchema,
	CategoryAggregateQuerySchema,
	ConnectionsQuerySchema,
	ErrorResponseSchema,
	PlatformStatsResponseSchema,
	SessionsResponseSchema,
	StatsQuerySchema,
} from '@modules/observability/schemas';
import { distinctOnlineDevices, getPlatformStats } from '@modules/observability/stats-service';
import { Elysia } from 'elysia';

/** Threshold (days): ranges longer than this default to the aggregate view. */
const AGGREGATE_THRESHOLD_DAYS = 7;

export const observabilityModule = withAuth(new Elysia({ prefix: '/api/admin' }))
	// GET /activity — Audit feed
	.get(
		'/activity',
		async ({ query }) => {
			const { rows, hasMore } = await listActivity({
				companyId: query.companyId,
				entityType: query.entityType as any,
				action: query.action as any,
				actorUserId: query.actorUserId,
				from: query.from,
				to: query.to,
				limit: query.limit,
				before: query.before,
			});
			return { data: rows, total: rows.length, hasMore };
		},
		{
			auth: true,
			superAdmin: true,
			query: ActivityQuerySchema,
			detail: {
				tags: ['Observability'],
				summary: 'Audit activity feed (super admin)',
				description:
					'Immutable audit log of platform mutations (who did what, when, on which entity). ' +
					'Filterable by company, entity type, action, actor, and time range. ' +
					'Cursor-paginated via `before` (row id). Newest-first.',
			},
			response: {
				200: ActivityListResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	)

	// GET /devices/connections — Session bands or aggregate buckets
	.get(
		'/devices/connections',
		async ({ query }) => {
			const from = query.from;
			const to = query.to;
			const rangeDays = (to.getTime() - from.getTime()) / 86_400_000;
			// Auto-select: long ranges → aggregate (avoid flooding the client).
			const requested = query.view ?? 'auto';
			const useAggregate =
				requested === 'aggregate' || (requested === 'auto' && rangeDays > AGGREGATE_THRESHOLD_DAYS);

			if (useAggregate) {
				const bucketSeconds = Math.max(3600, Math.round((rangeDays * 86_400) / 240));
				const buckets = await aggregateOnlineEvents({
					companyId: query.companyId,
					from,
					to,
					bucketSeconds,
				});
				const total = await countEventsInRange(query.companyId, from, to);
				return {
					view: 'aggregate',
					range: { from, to },
					data: buckets,
					total,
				};
			}

			const sessions = await listSessions({
				companyId: query.companyId,
				deviceId: query.deviceId,
				from,
				to,
			});
			const total = await countEventsInRange(query.companyId, from, to);
			return {
				view: 'session',
				range: { from, to },
				data: sessions,
				total,
			};
		},
		{
			auth: true,
			superAdmin: true,
			query: ConnectionsQuerySchema,
			detail: {
				tags: ['Observability'],
				summary: 'Device connection timeline (super admin)',
				description:
					'Online sessions as bands (start→end) for short ranges, or bucketed counts ' +
					'for long ranges (auto-selected beyond 7 days). Each band = one online session; ' +
					'an open session is closed at NOW(). Filter by company or single device.',
			},
			response: {
				200: SessionsResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	)

	// GET /categories — Cross-company category aggregation
	.get(
		'/categories',
		async ({ query }) => {
			const categories = await listAggregatedCategories({
				companyId: query.companyId,
				type: query.type,
			});
			return { data: categories, total: categories.length };
		},
		{
			auth: true,
			superAdmin: true,
			query: CategoryAggregateQuerySchema,
			detail: {
				tags: ['Observability'],
				summary: 'Aggregated categories (super admin)',
				description:
					'Device categories (garage / bus_line / region / yard / custom) across companies ' +
					'with live device counts. Powers the Groups section of the observability page.',
			},
			response: {
				200: AggregatedCategoryListResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	)

	// GET /stats — Platform-wide overview stats (rich overview page)
	.get(
		'/stats',
		async ({ query }) => {
			const now = new Date();
			const to = query.to ?? now;
			const from = query.from ?? new Date(to.getTime() - 7 * 86_400_000); // default 7d
			const [stats, onlineDevices] = await Promise.all([
				getPlatformStats(from, to),
				distinctOnlineDevices(from, to),
			]);
			return { ...stats, onlineDevices };
		},
		{
			auth: true,
			superAdmin: true,
			query: StatsQuerySchema,
			detail: {
				tags: ['Observability'],
				summary: 'Platform overview stats (super admin)',
				description:
					'Aggregated overview: daily online-device histogram, deployment/artifact counts, ' +
					'most active companies, update-hour distribution, and new user designations. ' +
					'Defaults to last 7 days; overridable with from/to.',
			},
			response: {
				200: PlatformStatsResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	);
