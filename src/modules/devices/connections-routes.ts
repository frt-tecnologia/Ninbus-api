import { env } from '@common/config/env';
import { withAuth } from '@common/middleware/auth-guard';
import { listConnectionEvents } from '@modules/observability/connections-service';
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

		const data = await listConnectionEvents({
			companyId: params.companyId,
			deviceId: query.deviceId,
			from,
			to,
		});

		return { range: { from, to }, data, total: data.length };
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
				'Raw online/offline transition events for the requester company devices within a time ' +
				'window (default last 24h). Each event is a single status change with its timestamp; ' +
				'the client computes the timeline bands from consecutive events. ' +
				'Query params: `from`, `to` (ISO 8601, optional), `deviceId` (optional filter). ' +
				'Capped at the telemetry retention window. Requires viewer role or above.',
		},
		response: {
			200: CompanyConnectionsResponseSchema,
			400: ErrorResponseSchema,
			403: ErrorResponseSchema,
		},
	},
);
