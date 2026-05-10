import { hawkbitTargets } from '@common/hawkbit/client';
import { withAuth } from '@common/middleware/auth-guard';
import {
	ActionStatusListResponseSchema,
	DeploymentStatisticsResponseSchema,
	ErrorResponseSchema,
	GenericActionResponseSchema,
	deploymentActionParams,
	deploymentParams,
} from '@modules/deployments/schemas';
import { Elysia, t } from 'elysia';
import * as service from './service';

const deviceParams = t.Object({
	companyId: t.String({ format: 'uuid' }),
	deviceId: t.String({ format: 'uuid' }),
});

/**
 * Deployment detail routes — statistics, targets, action management.
 *
 * Role requirements:
 * - GET /:id/statistics              → viewer (read stats)
 * - GET /:id/targets                 → viewer (read targets)
 * - GET /:id/targets/:t/actions/:a/status → viewer (read action history)
 * - DELETE /:id/targets/:t/actions/:a     → operator (cancel action)
 * - GET /devices/:id/actions         → viewer (read device actions)
 */
export const deploymentDeviceRoutes = withAuth(
	new Elysia({ prefix: '/api/companies/:companyId/deployments' }),
)
	// GET /:deploymentId/statistics
	.get(
		'/:deploymentId/statistics',
		async ({ params, set }) => {
			try {
				const stats = await service.getDeploymentStatistics(Number(params.deploymentId));
				return { data: stats };
			} catch {
				set.status = 404;
				return { error: 'Not Found', message: 'Deployment not found' };
			}
		},
		{
			auth: true,
			companyRole: 'viewer',
			params: deploymentParams,
			detail: {
				tags: ['Deployments'],
				summary: 'Get deployment statistics',
				description: 'Action counts by status from hawkBit',
			},
			response: {
				200: DeploymentStatisticsResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	)

	// GET /:deploymentId/targets — Targets assigned to this DS
	.get(
		'/:deploymentId/targets',
		async ({ params, query }) => {
			const result = await service.getDeploymentTargets(Number(params.deploymentId), {
				offset: query?.offset,
				limit: query?.limit,
			});
			return { data: result.content, total: result.total };
		},
		{
			auth: true,
			companyRole: 'viewer',
			params: deploymentParams,
			query: t.Object({
				offset: t.Optional(t.Number()),
				limit: t.Optional(t.Number({ maximum: 500 })),
			}),
			detail: { tags: ['Deployments'], summary: 'List targets in deployment' },
			response: {
				200: t.Object({ data: t.Array(t.Any()), total: t.Number() }),
				403: ErrorResponseSchema,
			},
		},
	)

	// GET /:deploymentId/targets/:targetId/actions/:actionId/status — Action history
	.get(
		'/:deploymentId/targets/:targetId/actions/:actionId/status',
		async ({ params, set }) => {
			try {
				const statusList = await hawkbitTargets.getActionStatus(
					params.targetId,
					Number(params.actionId),
				);
				return { data: statusList.content, total: statusList.total };
			} catch {
				set.status = 404;
				return { error: 'Not Found', message: 'Action not found' };
			}
		},
		{
			auth: true,
			companyRole: 'viewer',
			params: deploymentActionParams,
			detail: {
				tags: ['Deployments'],
				summary: 'Get action status history',
				description: 'Status updates for an action: running, downloaded, finished, error, etc.',
			},
			response: {
				200: ActionStatusListResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	)

	// DELETE /:deploymentId/targets/:targetId/actions/:actionId — Cancel action
	.delete(
		'/:deploymentId/targets/:targetId/actions/:actionId',
		async ({ params, set }) => {
			try {
				await hawkbitTargets.cancelAction(params.targetId, Number(params.actionId), true);
				return { message: 'Action cancelled successfully' };
			} catch {
				set.status = 422;
				return { error: 'Unprocessable Entity', message: 'Cannot cancel this action' };
			}
		},
		{
			auth: true,
			companyRole: 'operator',
			params: deploymentActionParams,
			detail: {
				tags: ['Deployments'],
				summary: 'Cancel deployment action',
				description: 'Cancels an active deployment action. Requires operator role or above.',
			},
			response: {
				200: GenericActionResponseSchema,
				403: ErrorResponseSchema,
				422: ErrorResponseSchema,
			},
		},
	)

	// GET /devices/:deviceId/actions — Device deployment history
	.get(
		'/devices/:deviceId/actions',
		async ({ params, query, set }) => {
			const { getDeviceById } = await import('@modules/devices/service');
			const device = await getDeviceById(params.deviceId, params.companyId);
			if (!device?.hawkbitTargetId) {
				set.status = 404;
				return { error: 'Not Found', message: 'Device not found or not linked to hawkBit' };
			}
			const actions = await hawkbitTargets.getActions(device.hawkbitTargetId, {
				limit: query?.limit ?? 50,
				sort: 'id:DESC',
			});
			return { data: actions.content, total: actions.total };
		},
		{
			auth: true,
			companyRole: 'viewer',
			params: deviceParams,
			query: t.Object({ limit: t.Optional(t.Number({ maximum: 100 })) }),
			detail: { tags: ['Deployments'], summary: 'Get device deployment actions' },
			response: {
				200: t.Object({ data: t.Array(t.Any()), total: t.Number() }),
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	);
