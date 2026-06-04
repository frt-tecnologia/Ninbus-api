/**
 * Deployment detail routes — statistics, targets, action management, status trail.
 */
import { hawkbitConfig } from '@common/config/hawkbit';
import { hawkbitTargets } from '@common/hawkbit/client';
import { appLogger } from '@common/logger';
import { withAuth } from '@common/middleware/auth-guard';
import {
	ActionStatusListResponseSchema,
	DeploymentStatisticsResponseSchema,
	ErrorResponseSchema,
	GenericActionResponseSchema,
	RawActionListResponseSchema,
	RawDiagnosticResponseSchema,
	RawTargetListResponseSchema,
	TargetStatusTrailResponseSchema,
	TargetStatusesResponseSchema,
	deploymentActionParams,
	deploymentParams,
} from '@modules/deployments/schemas';
import { Elysia, t } from 'elysia';
import * as service from './service';
const { DeploymentNotFoundError } = service;

const deviceParams = t.Object({
	companyId: t.String({ format: 'uuid' }),
	deviceId: t.String({ format: 'uuid' }),
});

export const deploymentDeviceRoutes = withAuth(
	new Elysia({ prefix: '/api/companies/:companyId/deployments' }),
)
	// GET /:deploymentId/statistics
	.get(
		'/:deploymentId/statistics',
		async ({ params, set }) => {
			try {
				// Ownership check: verify deployment belongs to this company
				await service.getDeployment(params.companyId, Number(params.deploymentId));
				const result = await service.getDeploymentStatistics(Number(params.deploymentId));
				return { data: result };
			} catch (error) {
				if (error instanceof service.DeploymentNotFoundError) {
					set.status = 404;
					return { error: 'Not Found', message: error.message };
				}
				set.status = 404;
				return { error: 'Not Found', message: 'Deployment not found' };
			}
		},
		{
			auth: true, companyRole: 'viewer', params: deploymentParams,
			detail: { tags: ['Deployments'], summary: 'Get deployment statistics' },
			response: { 200: DeploymentStatisticsResponseSchema, 403: ErrorResponseSchema, 404: ErrorResponseSchema, 503: ErrorResponseSchema },
		},
	)

	// GET /:deploymentId/target-statuses — All targets with enriched phase/progress
	.get(
		'/:deploymentId/target-statuses',
		async ({ params, query, set }) => {
			try {
				// Ownership check
				await service.getDeployment(params.companyId, Number(params.deploymentId));
				const result = await service.getDeploymentTargetStatuses(
					Number(params.deploymentId),
					{ offset: query?.offset, limit: query?.limit },
				);
				return { data: result.content, total: result.total };
			} catch (error) {
				appLogger.warn('[DEPLOYMENTS] target-statuses failed: %s', error instanceof Error ? error.message : String(error));
				set.status = 503;
				return { error: 'Service Unavailable', message: 'hawkBit is currently unavailable' };
			}
		},
		{
			auth: true, companyRole: 'viewer', params: deploymentParams,
			query: t.Object({ offset: t.Optional(t.Number()), limit: t.Optional(t.Number({ maximum: 500 })) }),
			detail: {
				tags: ['Deployments'],
				summary: 'Get all target statuses with phase and progress',
				description:
					'Each target includes semantic phase and download progress (0-100%). ' +
					'Phase values: assigned, pending, downloading, downloaded, installing, installed, error, canceled. ' +
					'See docs/hawkbit-status-flow-mapping.md for the full DDI feedback mapping.',
			},
			response: { 200: TargetStatusesResponseSchema, 403: ErrorResponseSchema, 503: ErrorResponseSchema },
		},
	)

	// GET /:deploymentId/targets/:targetId/status-trail — Full timeline
	.get(
		'/:deploymentId/targets/:targetId/status-trail',
		async ({ params, set }) => {
			try {
				// Ownership check
				await service.getDeployment(params.companyId, Number(params.deploymentId));
				const trail = await service.getTargetStatusTrail(params.targetId);
				if (!trail) {
					set.status = 404;
					return { error: 'Not Found', message: 'No deployment action found for this target' };
				}
				return { data: trail };
			} catch (error) {
				appLogger.warn('[DEPLOYMENTS] status-trail failed: %s', error instanceof Error ? error.message : String(error));
				set.status = 503;
				return { error: 'Service Unavailable', message: 'hawkBit is currently unavailable' };
			}
		},
		{
			auth: true, companyRole: 'viewer',
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				deploymentId: t.String({ description: 'hawkBit DS ID' }),
				targetId: t.String({ description: 'hawkBit controllerId (e.g. FF32FF51FFF1FFFF)' }),
			}),
			detail: {
				tags: ['Deployments'],
				summary: 'Get full status trail (timeline) for a target',
				description:
					'Complete timeline of status entries (oldest→newest) with phase, progress, and display message. ' +
					'Phase values: assigned, pending, downloading, downloaded, installing, installed, error, canceled. ' +
					'See docs/hawkbit-status-flow-mapping.md for the full DDI feedback mapping.',
			},
			response: { 200: TargetStatusTrailResponseSchema, 403: ErrorResponseSchema, 404: ErrorResponseSchema, 503: ErrorResponseSchema },
		},
	)

	// GET /:deploymentId/targets — Raw targets assigned to this DS
	.get(
		'/:deploymentId/targets',
		async ({ params, query, set }) => {
			try {
				// Ownership check
				await service.getDeployment(params.companyId, Number(params.deploymentId));
				const result = await service.getDeploymentTargets(Number(params.deploymentId), {
					offset: query?.offset, limit: query?.limit,
				});
				return { data: result.content, total: result.total };
			} catch (error) {
				appLogger.warn('[DEPLOYMENTS] list targets failed: %s', error instanceof Error ? error.message : String(error));
				set.status = 503;
				return { error: 'Service Unavailable', message: 'hawkBit is currently unavailable' };
			}
		},
		{
			auth: true, companyRole: 'viewer', params: deploymentParams,
			query: t.Object({ offset: t.Optional(t.Number()), limit: t.Optional(t.Number({ maximum: 500 })) }),
			detail: { tags: ['Deployments'], summary: 'List targets in deployment' },
			response: { 200: RawTargetListResponseSchema, 403: ErrorResponseSchema, 503: ErrorResponseSchema },
		},
	)

	// GET /:deploymentId/targets/:targetId/actions/:actionId/status — Raw action status history
	.get(
		'/:deploymentId/targets/:targetId/actions/:actionId/status',
		async ({ params, set }) => {
			try {
				const statusList = await hawkbitTargets.getActionStatus(params.targetId, Number(params.actionId));
				return { data: statusList.content, total: statusList.total };
			} catch {
				set.status = 404;
				return { error: 'Not Found', message: 'Action not found' };
			}
		},
		{
			auth: true, companyRole: 'viewer', params: deploymentActionParams,
			detail: { tags: ['Deployments'], summary: 'Get raw action status history' },
			response: { 200: ActionStatusListResponseSchema, 403: ErrorResponseSchema, 404: ErrorResponseSchema, 503: ErrorResponseSchema },
		},
	)

	// DELETE /:deploymentId/targets/:targetId/actions/:actionId — Cancel action
	.delete(
		'/:deploymentId/targets/:targetId/actions/:actionId',
		async ({ params, set }) => {
			try {
				await hawkbitTargets.cancelAction(params.targetId, Number(params.actionId), true);

				// After cancelling, protect target from sync engine re-marking as 'pending'
				// hawkBit may still report 'pending' until it processes the cancellation
				const { protectTargetStatuses } = await import('@modules/devices/sync-helpers');
				protectTargetStatuses([params.targetId], 'in_sync');

				return { message: 'Action cancelled successfully' };
			} catch {
				set.status = 422;
				return { error: 'Unprocessable Entity', message: 'Cannot cancel this action' };
			}
		},
		{
			auth: true, companyRole: 'operator', params: deploymentActionParams,
			detail: { tags: ['Deployments'], summary: 'Cancel deployment action' },
			response: { 200: GenericActionResponseSchema, 403: ErrorResponseSchema, 422: ErrorResponseSchema, 503: ErrorResponseSchema },
		},
	)

	// GET /:deploymentId/ddi-check/:targetId — DDI diagnostic for a target
	.get(
		'/:deploymentId/ddi-check/:targetId',
		async ({ params, set }) => {
			if (!hawkbitConfig.enabled) {
				set.status = 400;
				return { error: 'Bad Request', message: 'hawkBit integration is disabled' };
			}
			try {
				const diag = await service.checkDDiReadiness(params.targetId);
				return { data: diag };
			} catch (error) {
				appLogger.warn('[DEPLOYMENTS] ddi-check failed: %s', error instanceof Error ? error.message : String(error));
				set.status = 503;
				return { error: 'Service Unavailable', message: 'hawkBit is currently unavailable' };
			}
		},
		{
			auth: true, companyRole: 'viewer',
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				deploymentId: t.String({ description: 'hawkBit DS ID' }),
				targetId: t.String({ description: 'hawkBit controllerId' }),
			}),
			detail: {
				tags: ['Deployments'],
				summary: 'Check if target would receive deploymentBase via DDI',
				description:
					'Diagnostic endpoint that checks if a target would get deploymentBase from DDI poll. ' +
					'Checks for active update/cancel actions, DS completeness, and potential blockers. ' +
					'Use this to debug DDI issues when device polls but gets no deployment.',
			},
			response: { 200: RawDiagnosticResponseSchema, 400: ErrorResponseSchema, 403: ErrorResponseSchema, 503: ErrorResponseSchema },
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
			try {
				const actions = await hawkbitTargets.getActions(device.hawkbitTargetId, {
					limit: query?.limit ?? 50, sort: 'id:DESC',
				});
				return { data: actions.content, total: actions.total };
			} catch (error) {
				appLogger.warn('[DEPLOYMENTS] device actions failed: %s', error instanceof Error ? error.message : String(error));
				set.status = 503;
				return { error: 'Service Unavailable', message: 'hawkBit is currently unavailable' };
			}
		},
		{
			auth: true, companyRole: 'viewer', params: deviceParams,
			query: t.Object({ limit: t.Optional(t.Number({ maximum: 100 })) }),
			detail: { tags: ['Deployments'], summary: 'Get device deployment actions' },
			response: { 200: RawActionListResponseSchema, 403: ErrorResponseSchema, 404: ErrorResponseSchema, 503: ErrorResponseSchema },
		},
	);
