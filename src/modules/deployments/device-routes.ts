import { hawkbitTargets } from '@common/hawkbit/client';
import { withAuth } from '@common/middleware/auth-guard';
import { checkMembership } from '@common/middleware/company-check';
import {
	ActionStatusListResponseSchema,
	DeploymentStatisticsResponseSchema,
	DeviceActionsResponseSchema,
	ErrorResponseSchema,
	GenericActionResponseSchema,
	deploymentActionParams,
	deploymentParams,
} from '@modules/deployments/schemas';
import { Elysia, t } from 'elysia';
import * as service from './service';

/** Params for routes that have companyId + deviceId (Ninbus device) */
const deviceHistoryParams = t.Object({
	companyId: t.String({ format: 'uuid' }),
	deviceId: t.String({ format: 'uuid' }),
});

/**
 * Deployment device-level routes — statistics, targets, action status, cancel.
 */
export const deploymentDeviceRoutes = withAuth(
	new Elysia({ prefix: '/api/companies/:companyId/deployments' }),
)
	// GET /:deploymentId/statistics — Deployment statistics
	.get(
		'/:deploymentId/statistics',
		async ({ params, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
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
			params: deploymentParams,
			detail: {
				tags: ['Deployments'],
				summary: 'Get deployment statistics',
				description:
					'Real-time progress from hawkBit: actions by status (running, finished, error, etc.).',
			},
			response: {
				200: DeploymentStatisticsResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	)

	// GET /:deploymentId/targets — List targets assigned to deployment
	.get(
		'/:deploymentId/targets',
		async ({ params, query, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			const result = await service.getDeploymentTargets(Number(params.deploymentId), {
				offset: query?.offset,
				limit: query?.limit,
			});
			return { data: result.content, total: result.total };
		},
		{
			auth: true,
			params: deploymentParams,
			query: t.Object({
				offset: t.Optional(t.Number()),
				limit: t.Optional(t.Number({ maximum: 500 })),
			}),
			detail: {
				tags: ['Deployments'],
				summary: 'List targets assigned to deployment',
			},
			response: {
				200: t.Object({ data: t.Array(t.Any()), total: t.Number() }),
				403: ErrorResponseSchema,
			},
		},
	)

	// GET /:deploymentId/targets/:targetId/actions/:actionId/status — Action status history
	.get(
		'/:deploymentId/targets/:targetId/actions/:actionId/status',
		async ({ params, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			try {
				const statusList = await hawkbitTargets.getActionStatus(
					params.targetId,
					Number(params.actionId),
				);
				return { data: statusList.content, total: statusList.total };
			} catch {
				set.status = 404;
				return { error: 'Not Found', message: 'Action status not found' };
			}
		},
		{
			auth: true,
			params: deploymentActionParams,
			detail: {
				tags: ['Deployments'],
				summary: 'Get action status history',
				description:
					'Detailed status updates for a deployment action (running, downloaded, finished, error, etc.)',
			},
			response: {
				200: ActionStatusListResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	)

	// DELETE /:deploymentId/targets/:targetId/actions/:actionId — Cancel action for a target
	.delete(
		'/:deploymentId/targets/:targetId/actions/:actionId',
		async ({ params, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			try {
				await hawkbitTargets.cancelAction(params.targetId, Number(params.actionId), true);
				return { message: 'Action cancelled successfully' };
			} catch {
				set.status = 422;
				return {
					error: 'Unprocessable Entity',
					message: 'Cannot cancel this action',
				};
			}
		},
		{
			auth: true,
			params: deploymentActionParams,
			detail: {
				tags: ['Deployments'],
				summary: 'Cancel deployment action for a target',
			},
			response: {
				200: GenericActionResponseSchema,
				403: ErrorResponseSchema,
				422: ErrorResponseSchema,
			},
		},
	)

	// GET /devices/:deviceId/actions — Get device deployment history
	.get(
		'/devices/:deviceId/actions',
		async ({ params, query, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			const { getDeviceById } = await import('@modules/devices/service');
			const device = await getDeviceById(params.deviceId, params.companyId);
			if (!device || !device.hawkbitTargetId) {
				set.status = 404;
				return {
					error: 'Not Found',
					message: 'Device not found or not linked to hawkBit',
				};
			}
			const actions = await hawkbitTargets.getActions(device.hawkbitTargetId, {
				limit: query?.limit ?? 50,
				sort: 'id:DESC',
			});
			return { data: actions.content, total: actions.total };
		},
		{
			auth: true,
			params: deviceHistoryParams,
			query: t.Object({
				limit: t.Optional(t.Number({ maximum: 100 })),
			}),
			detail: {
				tags: ['Deployments'],
				summary: 'Get device deployment actions',
			},
			response: {
				200: DeviceActionsResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	);
