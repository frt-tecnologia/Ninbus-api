import { withAuth } from '@common/middleware/auth-guard';
import { checkMembership } from '@common/middleware/company-check';
import {
	ErrorResponseSchema,
	GenericActionResponseSchema,
	abortDeploymentSchema,
	deploymentDeviceLogParams,
	deploymentParams,
} from '@modules/deployments/schemas';
import { Elysia, t } from 'elysia';
import * as service from './service';

/** Params for routes that have companyId + deviceId (Ninbus device) */
const deviceHistoryParams = t.Object({
	companyId: t.String({ format: 'uuid' }),
	deviceId: t.String({ format: 'uuid' }),
});
/** Params for routes with companyId + menderDeviceId */
const menderDeviceParams = t.Object({
	companyId: t.String({ format: 'uuid' }),
	menderDeviceId: t.String(),
});

/**
 * Deployment device-level routes — per-device abort, device list, logs, history.
 */
export const deploymentDeviceRoutes = withAuth(
	new Elysia({ prefix: '/api/companies/:companyId/deployments' }),
)
	// PUT /:deploymentId/status — Abort entire deployment
	.put(
		'/:deploymentId/status',
		async ({ params, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			try {
				await service.abortDeployment(params.deploymentId);
				return { message: 'Deployment aborted successfully' };
			} catch {
				set.status = 422;
				return { error: 'Unprocessable Entity', message: 'Cannot abort this deployment' };
			}
		},
		{
			auth: true,
			params: deploymentParams,
			body: abortDeploymentSchema,
			detail: { tags: ['Deployments'], summary: 'Abort entire deployment' },
			response: {
				200: GenericActionResponseSchema,
				403: ErrorResponseSchema,
				422: ErrorResponseSchema,
			},
		},
	)

	// DELETE /devices/:menderDeviceId/deployments — Abort all active deployments for a device
	.delete(
		'/devices/:menderDeviceId/deployments',
		async ({ params, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			try {
				await service.abortDeviceDeployment(params.menderDeviceId);
				return { message: 'Device deployments aborted successfully' };
			} catch {
				set.status = 422;
				return {
					error: 'Unprocessable Entity',
					message: 'Cannot abort deployments for this device',
				};
			}
		},
		{
			auth: true,
			params: menderDeviceParams,
			detail: {
				tags: ['Deployments'],
				summary: 'Abort all active deployments for a device',
				description: 'Aborts all active OTA deployments for a specific device via Mender DELETE.',
			},
			response: {
				200: GenericActionResponseSchema,
				403: ErrorResponseSchema,
				422: ErrorResponseSchema,
			},
		},
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
				const stats = await service.getDeploymentStatistics(params.deploymentId);
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
				description: 'Real-time progress: success, pending, failure, downloading, installing, etc.',
			},
			response: {
				200: GenericActionResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	)

	// GET /:deploymentId/devices — List devices in deployment
	.get(
		'/:deploymentId/devices',
		async ({ params, query, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			const devlist = await service.getDeploymentDevices(params.deploymentId, {
				status: query?.status,
				page: query?.page,
				perPage: query?.perPage,
			});
			return { data: devlist, total: devlist.length };
		},
		{
			auth: true,
			params: deploymentParams,
			query: t.Object({
				status: t.Optional(t.String({ description: 'Filter by device status' })),
				page: t.Optional(t.Number({ description: 'Page number' })),
				perPage: t.Optional(t.Number({ description: 'Items per page', maximum: 500 })),
			}),
			detail: { tags: ['Deployments'], summary: 'List devices in deployment' },
			response: { 200: GenericActionResponseSchema, 403: ErrorResponseSchema },
		},
	)

	// GET /:deploymentId/devices/:menderDeviceId/log — Device deployment log
	.get(
		'/:deploymentId/devices/:menderDeviceId/log',
		async ({ params, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			try {
				const log = await service.getDeviceDeploymentLog(
					params.deploymentId,
					params.menderDeviceId,
				);
				return { data: log };
			} catch {
				set.status = 404;
				return { error: 'Not Found', message: 'Log not found' };
			}
		},
		{
			auth: true,
			params: deploymentDeviceLogParams,
			detail: { tags: ['Deployments'], summary: 'Get device deployment log' },
			response: {
				200: GenericActionResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	)

	// GET /devices/:deviceId/history — Device deployment history
	.get(
		'/devices/:deviceId/history',
		async ({ params, query, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			const { getDeviceById } = await import('@modules/devices/service');
			const device = await getDeviceById(params.deviceId, params.companyId);
			if (!device || !device.menderDeviceId) {
				set.status = 404;
				return { error: 'Not Found', message: 'Device not found or not linked to Mender' };
			}
			const history = await service.getDeviceDeploymentHistory(device.menderDeviceId, {
				status: query?.status,
				page: query?.page,
				perPage: query?.perPage,
			});
			return { data: history };
		},
		{
			auth: true,
			params: deviceHistoryParams,
			query: t.Object({
				status: t.Optional(t.String()),
				page: t.Optional(t.Number()),
				perPage: t.Optional(t.Number({ maximum: 20 })),
			}),
			detail: { tags: ['Deployments'], summary: 'Get device deployment history' },
			response: {
				200: GenericActionResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	);
