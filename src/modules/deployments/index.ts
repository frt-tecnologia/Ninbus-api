import { NINBUS_ARTIFACT_TYPE_META } from '@common/hawkbit/client';
import { HawkbitApiError } from '@common/hawkbit/http';
import { appLogger } from '@common/logger';
import { withAuth } from '@common/middleware/auth-guard';
import {
	ArtifactTypeListResponseSchema,
	DeploymentCreateResponseSchema,
	DeploymentListResponseSchema,
	DeploymentResponseSchema,
	ErrorResponseSchema,
	GenericActionResponseSchema,
	createOtaDeploymentSchema,
} from '@modules/deployments/schemas';
import { Elysia, t } from 'elysia';
import { DeploymentNotFoundError } from './service';
import * as service from './service';

/**
 * Deployments Module — OTA deployment management via hawkBit.
 *
 * Role requirements:
 * - GET /artifact-types  → viewer (reference data)
 * - POST /               → operator (create deployment — writes to hawkBit)
 * - GET /                → viewer (list deployments)
 * - GET /:id             → viewer (view deployment)
 * - DELETE /:id          → admin (delete deployment)
 */
export const deploymentsModule = withAuth(
	new Elysia({ prefix: '/api/companies/:companyId/deployments' }),
)
	// GET /artifact-types — List supported artifact types
	.get(
		'/artifact-types',
		async () => {
			return {
				data: Object.entries(NINBUS_ARTIFACT_TYPE_META).map(([type, meta]) => ({
					type,
					...meta,
				})),
			};
		},
		{
			auth: true,
			companyRole: 'viewer',
			params: t.Object({ companyId: t.String({ format: 'uuid' }) }),
			detail: {
				tags: ['Deployments'],
				summary: 'List supported artifact types',
				description:
					'All Ninbus artifact types with metadata (risk level, target, reboot requirement)',
			},
			response: {
				200: ArtifactTypeListResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	)

	// POST / — Create OTA deployment
	.post(
		'/',
		async ({ params, body, user, set }) => {
			if (!body.deviceIds && !body.categoryIds && !body.allDevices) {
				set.status = 400;
				return {
					error: 'Bad Request',
					message: 'Must specify deviceIds, categoryIds, or allDevices',
				};
			}
			try {
				const deployment = await service.createDeployment(params.companyId, user.id, {
					name: body.name,
					artifactName: body.artifactName,
					artifactType: body.artifactType,
					version: body.version,
					deviceIds: body.deviceIds,
					categoryIds: body.categoryIds,
					allDevices: body.allDevices,
				});
				set.status = 201;

				// SSE: notify connected clients that deployment was created
				try {
					const { sseEmitter } = await import('@common/sse');
					sseEmitter.emit(params.companyId, 'deployment.created', {
						deploymentId: deployment.dsId,
						name: body.name,
						artifactType: body.artifactType ?? 'firmware',
					});
				} catch { /* SSE emission failure is non-critical */ }

				return { message: 'Deployment created successfully', data: deployment };
			} catch (error: any) {
				if (error instanceof HawkbitApiError) {
					if (error.status === 409) {
						set.status = 409;
						return { error: 'Conflict', message: 'Distribution Set collision in hawkBit — please retry.' };
					}
					appLogger.error('[DEPLOYMENTS] hawkBit API error: %s', `${error.status} ${error.message}`);
					set.status = 502;
					const detail = typeof error.body === 'object' && error.body && 'message' in error.body ? (error.body as any).message : error.message;
					return { error: 'Bad Gateway', message: `hawkBit returned error (${error.status}): ${detail}` };
				}
				if (
					error.message?.includes('not found') ||
					error.message?.includes('not compatible') ||
					error.message?.includes('No eligible')
				) {
					set.status = 422;
					return { error: 'Unprocessable Entity', message: error.message };
				}
				appLogger.warn('[DEPLOYMENTS] Failed to create:', error?.constructor?.name, error?.message);
				set.status = 503;
				return { error: 'Service Unavailable', message: `Deployment creation failed: ${error?.message ?? 'unknown error'}` };
			}
		},
		{
			auth: true,
			companyRole: 'operator',
			params: t.Object({ companyId: t.String({ format: 'uuid' }) }),
			body: createOtaDeploymentSchema,
			detail: {
				tags: ['Deployments'],
				summary: 'Create OTA deployment',
				description:
					'Creates a Distribution Set in hawkBit and assigns it to target devices. ' +
					'Requires operator role or above.',
			},
			response: {
				201: DeploymentCreateResponseSchema,
				400: ErrorResponseSchema,
				403: ErrorResponseSchema,
				422: ErrorResponseSchema,
				503: ErrorResponseSchema,
			},
		},
	)

	// GET / — List deployments for this company only
	.get(
		'/',
		async ({ params, query, set }) => {
			try {
				const result = await service.listDeployments(params.companyId, {
					offset: query?.offset,
					limit: query?.limit,
				});
				return result;
			} catch (error) {
				appLogger.warn('[DEPLOYMENTS] Failed to list: %s', error instanceof Error ? error.message : String(error));
				set.status = 503;
				return { error: 'Service Unavailable', message: 'Deployment service (hawkBit) is currently unavailable' };
			}
		},
		{
			auth: true,
			companyRole: 'viewer',
			params: t.Object({ companyId: t.String({ format: 'uuid' }) }),
			query: t.Object({
				offset: t.Optional(t.Number()),
				limit: t.Optional(t.Number({ maximum: 500 })),
			}),
			detail: { tags: ['Deployments'], summary: 'List deployments (Distribution Sets) for this company' },
			response: {
				200: DeploymentListResponseSchema,
				403: ErrorResponseSchema,
				503: ErrorResponseSchema,
			},
		},
	)

	// GET /:deploymentId — Get deployment details
	.get(
		'/:deploymentId',
		async ({ params, set }) => {
			try {
				const deployment = await service.getDeployment(params.companyId, Number(params.deploymentId));
				return { data: deployment };
			} catch (error) {
				if (error instanceof DeploymentNotFoundError) {
					set.status = 404;
					return { error: 'Not Found', message: error.message };
				}
				set.status = 404;
				return { error: 'Not Found', message: 'Deployment not found' };
			}
		},
		{
			auth: true,
			companyRole: 'viewer',
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				deploymentId: t.String({ description: 'hawkBit Distribution Set ID' }),
			}),
			detail: { tags: ['Deployments'], summary: 'Get deployment (Distribution Set) details' },
			response: {
				200: DeploymentResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
				503: ErrorResponseSchema,
			},
		},
	)

	// DELETE /:deploymentId — Delete deployment
	.delete(
		'/:deploymentId',
		async ({ params, set }) => {
			try {
				await service.deleteDeployment(Number(params.deploymentId), params.companyId);
				return { message: 'Deployment deleted successfully' };
			} catch (error: any) {
				if (error instanceof DeploymentNotFoundError) {
					set.status = 404;
					return { error: 'Not Found', message: error.message };
				}
				if (error?.status === 404) {
					set.status = 404;
					return { error: 'Not Found', message: 'Deployment not found' };
				}
				appLogger.warn('[DEPLOYMENTS] Delete failed: %s', error?.message ?? String(error));
				set.status = 503;
				return { error: 'Service Unavailable', message: `Failed to delete deployment: ${error?.message ?? 'hawkBit error'}` };
			}
		},
		{
			auth: true,
			companyRole: 'admin',
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				deploymentId: t.String({ description: 'hawkBit Distribution Set ID' }),
			}),
			detail: {
				tags: ['Deployments'],
				summary: 'Delete deployment (Distribution Set)',
				description:
					'Deletes a deployment from hawkBit. Cancels all active actions first, ' +
					'then deletes the Distribution Set. Devices will no longer see this deployment via DDI. ' +
					'Requires admin role or above.',
			},
			response: {
				200: GenericActionResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
				503: ErrorResponseSchema,
			},
		},
	);
