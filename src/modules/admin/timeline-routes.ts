import { withAuth } from '@common/middleware/auth-guard';
import { ErrorResponseSchema } from '@common/schemas';
import { Elysia, t } from 'elysia';
import { buildTimeline, fetchDeploymentsForTimeline } from './timeline-service';

/** Deployment activity time series (platform super admin) — see docs/dashboard-v3-refinement-plan.md. */
export const adminTimelineModule = new Elysia({ prefix: '/api/admin/deployments' })
	.use(withAuth)

	.get(
		'/timeline',
		async ({ query }) => {
			if (query.from.getTime() >= query.to.getTime()) {
				return new Response(
					JSON.stringify({ error: 'Validation error', message: '`from` must be before `to`' }),
					{ status: 400, headers: { 'content-type': 'application/json' } },
				);
			}
			const rows = await fetchDeploymentsForTimeline(query.from, query.to);
			const timeline = buildTimeline(rows, query.from, query.to, query.buckets ?? 24);
			return timeline;
		},
		{
			auth: true,
			superAdmin: true,
			query: t.Object({
				from: t.Date({ description: 'Window start (inclusive), ISO 8601' }),
				to: t.Date({ description: 'Window end (inclusive), ISO 8601' }),
				buckets: t.Optional(t.Number({ minimum: 2, maximum: 240 })),
			}),
			detail: {
				tags: ['Admin'],
				summary: 'Deployment activity time series (factory only)',
				description:
					'Buckets of `assigned` (rollouts created) and terminal outcomes ' +
					'(`installed`/`failed`/`canceled`) confirmed in the window. Counts are events ' +
					'per bucket from the canonical per-target snapshot; non-terminal phases are ' +
					'current state and are not part of the series.',
			},
			response: {
				200: t.Object({
					from: t.String(),
					to: t.String(),
					bucketMs: t.Number(),
					data: t.Array(
						t.Object({
							start: t.String(),
							end: t.String(),
							assigned: t.Number(),
							installed: t.Number(),
							failed: t.Number(),
							canceled: t.Number(),
						}),
					),
				}),
				400: ErrorResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	);
