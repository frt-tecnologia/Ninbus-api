import { NINBUS_ARTIFACT_TYPE_META } from '@common/mender/client';
import { withAuth } from '@common/middleware/auth-guard';
import { checkMembership } from '@common/middleware/company-check';
import {
	ArtifactTypeListResponseSchema,
	DeploymentCreateResponseSchema,
	DeploymentResponseSchema,
	ErrorResponseSchema,
	createOtaDeploymentSchema,
} from '@modules/deployments/schemas';
import { Elysia, t } from 'elysia';
import * as service from './service';

/**
 * Deployments Module — OTA deployment management via Mender.
 *
 * Three artifact types for Ninbus WiFi v3:
 * - firmware-ninbus       → NAND firmware (HIGH risk, requires reboot)
 * - firmware-controller   → CAN → LightDot (MEDIUM risk)
 * - configuration-nfx     → NAND NFX → CAN → LightDot (LOW risk)
 */
export const deploymentsModule = withAuth(
	new Elysia({ prefix: '/api/companies/:companyId/deployments' }),
)
	// GET /artifact-types — List supported artifact types
	.get(
		'/artifact-types',
		async ({ params, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			return {
				data: Object.entries(NINBUS_ARTIFACT_TYPE_META).map(([type, meta]) => ({ type, ...meta })),
			};
		},
		{
			auth: true,
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
		async ({ params, body, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			if (!body.deviceIds && !body.categoryIds && !body.allDevices) {
				set.status = 400;
				return {
					error: 'Bad Request',
					message: 'Must specify deviceIds, categoryIds, or allDevices',
				};
			}
			try {
				const deployment = await service.createDeployment(params.companyId, {
					name: body.name,
					artifactName: body.artifactName,
					artifactType: body.artifactType,
					deviceIds: body.deviceIds,
					categoryIds: body.categoryIds,
					allDevices: body.allDevices,
					retries: body.retries,
				});
				set.status = 201;
				return { message: 'Deployment created successfully', data: deployment };
			} catch (error: any) {
				if (
					error.message?.includes('not found') ||
					error.message?.includes('not compatible') ||
					error.message?.includes('No eligible')
				) {
					set.status = 422;
					return { error: 'Unprocessable Entity', message: error.message };
				}
				throw error;
			}
		},
		{
			auth: true,
			params: t.Object({ companyId: t.String({ format: 'uuid' }) }),
			body: createOtaDeploymentSchema,
			detail: {
				tags: ['Deployments'],
				summary: 'Create OTA deployment',
				description:
					'Creates a deployment targeting devices by ID, category, or all company devices.\n\n' +
					'| Type | Destination | Risk | Reboot |\n' +
					'|------|-------------|------|--------|\n' +
					'| firmware-ninbus | NAND → Bootloader → STM32F407 | HIGH | YES |\n' +
					'| firmware-controller | CAN → LightDot | MEDIUM | NO |\n' +
					'| configuration-nfx | NAND NFX → CAN → LightDot | LOW | NO |',
			},
			response: {
				201: DeploymentCreateResponseSchema,
				400: ErrorResponseSchema,
				403: ErrorResponseSchema,
				422: ErrorResponseSchema,
			},
		},
	)

	// GET /:deploymentId — Get deployment details
	.get(
		'/:deploymentId',
		async ({ params, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			try {
				const deployment = await service.getDeployment(params.deploymentId);
				return { data: deployment };
			} catch {
				set.status = 404;
				return { error: 'Not Found', message: 'Deployment not found' };
			}
		},
		{
			auth: true,
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				deploymentId: t.String({ description: 'Mender deployment ID' }),
			}),
			detail: { tags: ['Deployments'], summary: 'Get deployment details' },
			response: {
				200: DeploymentResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	);
