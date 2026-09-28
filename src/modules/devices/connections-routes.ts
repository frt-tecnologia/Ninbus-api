import { env } from '@common/config/env';
import { withAuth } from '@common/middleware/auth-guard';
import {
	countEventsInRange,
	listConnectionEvents,
	listSessions,
	listStateAtFrom,
} from '@modules/observability/connections-service';
import {
	CompanyConnectionsQuerySchema,
	CompanyConnectionsResponseSchema,
	ErrorResponseSchema,
} from '@modules/observability/schemas';
import { Elysia, t } from 'elysia';

/** Max window (days) a client may request — aligns with telemetry retention. */
const MAX_WINDOW_DAYS = env.OBS_CONNECTIONS_RETENTION_DAYS ?? 90;
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

const params = t.Object({ companyId: t.String({ format: 'uuid' }) });

/**
 * Company-scoped device connection timeline (member-facing reports screen).
 *
 * Returns RAW transition events (online↔offline + timestamp) for the devices of
 * the requester's company within [from, to] (default last 24h). The UI computes
 * the timeline bands from these events; the server does NOT pre-compute sessions.
 *
 * Tenant isolation: filtered by `companyId` (companyRole macro already verified
 * membership). `viewer` role — read-only.
 */
export const deviceConnectionsRoutes = withAuth(
	new Elysia({ prefix: '/api/companies/:companyId/devices' }),
).get(
	'/connections',
	async ({ params, query, set }) => {
		const now = new Date();
		const to = query.to ?? now;
		const from = query.from ?? new Date(now.getTime() - DEFAULT_WINDOW_MS);

		if (from.getTime() > to.getTime()) {
			set.status = 400;
			return { error: 'Bad Request', message: '`from` must be before or equal to `to`' };
		}
		const rangeDays = (to.getTime() - from.getTime()) / 86_400_000;
		if (rangeDays > MAX_WINDOW_DAYS) {
			set.status = 400;
			return {
				error: 'Bad Request',
				message: `Requested range (${Math.round(rangeDays)}d) exceeds the maximum of ${MAX_WINDOW_DAYS} days`,
			};
		}

		const view = query.view ?? 'events';
		const data =
			view === 'bands'
				? await listSessions({
						companyId: params.companyId,
						deviceId: query.deviceId,
						from,
						to,
						limit: query.limit,
						offset: query.offset,
					})
				: await listConnectionEvents({
						companyId: params.companyId,
						deviceId: query.deviceId,
						from,
						to,
						limit: query.limit,
						offset: query.offset,
					});
		// Bands derive 1:1 from 'online' events — same page math either view.
		const total = await countEventsInRange(params.companyId, from, to);
		const states = await listStateAtFrom({
			companyId: params.companyId,
			from,
			deviceId: query.deviceId,
		});

		return {
			range: { from, to },
			data,
			total,
			states,
			hasMore: (query.offset ?? 0) + data.length < total,
		};
	},
	{
		auth: true,
		companyRole: 'viewer',
		params,
		query: CompanyConnectionsQuerySchema,
		detail: {
			tags: ['Devices'],
			summary: 'Device connection timeline (company-scoped)',
			description:
				'Raw online/offline transition events (view=events, default) or server-computed ' +
				'online session bands (view=bands) for the requester company devices within a ' +
				'window (default last 24h). PAGINATED (?limit default 2000/max 10000 + ?offset, ' +
				'hasMore; total counts the whole window). `states` carries each device\u2019s state ' +
				'AT the window start (last event before `from`) — anchor the first band on it ' +
				'instead of guessing. Offline events date from the MISSED poll deadline ' +
				'(nextExpectedPollAt). Query: from, to (ISO 8601), deviceId, limit, offset, view. ' +
				'Capped at the telemetry retention window. Requires viewer role or above.',
		},
		response: {
			200: CompanyConnectionsResponseSchema,
			400: ErrorResponseSchema,
			403: ErrorResponseSchema,
		},
	},
);
