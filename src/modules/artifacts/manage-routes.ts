import { appLogger } from '@common/logger';
import { withAuth } from '@common/middleware/auth-guard';
import {
	ArtifactDeleteResponseSchema,
	ArtifactListResponseSchema,
	ArtifactResponseSchema,
	DownloadArtifactResponseSchema,
	ErrorResponseSchema,
	GenericActionResponseSchema,
	updateArtifactSchema,
} from '@modules/artifacts/schemas';
import { logActivity } from '@modules/observability/activity-service';
import { Elysia, t } from 'elysia';
import { ArtifactLockedError, ArtifactNotFoundError, ArtifactValidationError } from './service';
import * as service from './service';

/**
 * Artifact management routes — list, get, update, delete, download.
 *
 * Role requirements:
 * - GET /                → viewer (list artifacts)
 * - GET /:id             → viewer (view artifact)
 * - GET /:id/download    → viewer (download info)
 * - PUT /:id             → operator (update metadata)
 * - DELETE /:id          → admin (delete artifact)
 */
export const artifactManageRoutes = withAuth(
	new Elysia({ prefix: '/api/companies/:companyId/artifacts' }),
)
	// GET / — List software modules (artifacts) for this company only
	.get(
		'/',
		async ({ params, query, set }) => {
			try {
				const result = await service.listArtifacts(params.companyId, {
					offset: query?.offset,
					limit: query?.limit,
				});
				return result;
			} catch (error: any) {
				appLogger.error('[ARTIFACTS] Failed to list artifacts: %s', error?.message ?? 'unknown');
				set.status = 503;
				return {
					error: 'Service Unavailable',
					message: 'Artifact service (hawkBit) is currently unavailable',
				};
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
			detail: {
				tags: ['Artifacts'],
				summary: 'List OTA artifacts (Software Modules)',
				description:
					'Lists software modules belonging to this company from hawkBit enriched with Ninbus type metadata',
			},
			response: {
				200: ArtifactListResponseSchema,
				403: ErrorResponseSchema,
				503: ErrorResponseSchema,
			},
		},
	)

	// GET /:artifactId — Get artifact details
	.get(
		'/:artifactId',
		async ({ params, set }) => {
			try {
				const artifact = await service.getArtifact(params.companyId, Number(params.artifactId));
				return { data: artifact };
			} catch (error) {
				if (error instanceof ArtifactNotFoundError) {
					set.status = 404;
					return { error: 'Not Found', message: error.message };
				}
				if (error instanceof ArtifactValidationError) {
					set.status = 400;
					return { error: 'Bad Request', message: error.message };
				}
				appLogger.warn(
					'[ARTIFACTS] Failed to get artifact: %s',
					error instanceof Error ? error.message : String(error),
				);
				set.status = 503;
				return {
					error: 'Service Unavailable',
					message: 'Artifact service (hawkBit) is currently unavailable',
				};
			}
		},
		{
			auth: true,
			companyRole: 'viewer',
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				artifactId: t.String({ description: 'hawkBit Software Module ID' }),
			}),
			detail: {
				tags: ['Artifacts'],
				summary: 'Get artifact details (Software Module)',
			},
			response: {
				200: ArtifactResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
				503: ErrorResponseSchema,
			},
		},
	)

	// DELETE /:artifactId — Delete artifact
	.delete(
		'/:artifactId',
		async ({ params, user, set }) => {
			try {
				const result = await service.deleteArtifact(params.companyId, Number(params.artifactId));
				await logActivity({
					actorUserId: user.id,
					actorEmail: user.email,
					companyId: params.companyId,
					action: 'artifact.deleted',
					entityType: 'artifact',
					entityId: params.artifactId,
					metadata: { cleanedUp: result.cleanedUp },
				});
				return { message: result.message, cleanedUp: result.cleanedUp };
			} catch (error) {
				if (error instanceof ArtifactNotFoundError) {
					set.status = 404;
					return { error: 'Not Found', message: error.message };
				}
				if (error instanceof ArtifactValidationError) {
					set.status = 400;
					return { error: 'Bad Request', message: error.message };
				}
				if (error instanceof ArtifactLockedError) {
					set.status = 409;
					return { error: 'Locked', message: error.message, blockingDS: error.blockingDS };
				}
				appLogger.warn(
					'[ARTIFACTS] Failed to delete artifact: %s',
					error instanceof Error ? error.message : String(error),
				);
				set.status = 503;
				return {
					error: 'Service Unavailable',
					message: 'Artifact service (hawkBit) is currently unavailable',
				};
			}
		},
		{
			auth: true,
			companyRole: 'admin',
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				artifactId: t.String({ description: 'hawkBit Software Module ID' }),
			}),
			detail: {
				tags: ['Artifacts'],
				summary: 'Delete artifact (Software Module)',
				description: 'Deletes an artifact from hawkBit. Requires admin role or above.',
			},
			response: {
				200: ArtifactDeleteResponseSchema,
				403: ErrorResponseSchema,
				409: ErrorResponseSchema,
				503: ErrorResponseSchema,
			},
		},
	)

	// PUT /:artifactId — Update artifact metadata
	.put(
		'/:artifactId',
		async ({ params, body, set }) => {
			try {
				await service.updateArtifact(params.companyId, Number(params.artifactId), body.description);
				return { message: 'Artifact updated successfully' };
			} catch (error) {
				if (error instanceof ArtifactNotFoundError) {
					set.status = 404;
					return { error: 'Not Found', message: error.message };
				}
				if (error instanceof ArtifactValidationError) {
					set.status = 400;
					return { error: 'Bad Request', message: error.message };
				}
				appLogger.warn(
					'[ARTIFACTS] Failed to update artifact: %s',
					error instanceof Error ? error.message : String(error),
				);
				set.status = 503;
				return {
					error: 'Service Unavailable',
					message: 'Artifact service (hawkBit) is currently unavailable',
				};
			}
		},
		{
			auth: true,
			companyRole: 'operator',
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				artifactId: t.String({ description: 'hawkBit Software Module ID' }),
			}),
			body: updateArtifactSchema,
			detail: {
				tags: ['Artifacts'],
				summary: 'Update artifact metadata',
				description: 'Updates artifact description. Requires operator role or above.',
			},
			response: {
				200: GenericActionResponseSchema,
				403: ErrorResponseSchema,
				503: ErrorResponseSchema,
			},
		},
	)

	// GET /:artifactId/download — Get artifact download info
	.get(
		'/:artifactId/download',
		async ({ params, query, set }) => {
			try {
				const downloadInfo = await service.getArtifactDownloadUrl(
					params.companyId,
					Number(params.artifactId),
					Number(query?.artifactFileId ?? 0),
				);
				return { data: downloadInfo };
			} catch (error) {
				if (error instanceof ArtifactNotFoundError) {
					set.status = 404;
					return { error: 'Not Found', message: error.message };
				}
				if (error instanceof ArtifactValidationError) {
					set.status = 400;
					return { error: 'Bad Request', message: error.message };
				}
				appLogger.warn(
					'[ARTIFACTS] Failed to get download info: %s',
					error instanceof Error ? error.message : String(error),
				);
				set.status = 503;
				return {
					error: 'Service Unavailable',
					message: 'Artifact service (hawkBit) is currently unavailable',
				};
			}
		},
		{
			auth: true,
			companyRole: 'viewer',
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				artifactId: t.String({ description: 'hawkBit Software Module ID' }),
			}),
			query: t.Object({
				artifactFileId: t.Optional(
					t.Number({ description: 'Specific artifact file ID (within the SM)' }),
				),
			}),
			detail: {
				tags: ['Artifacts'],
				summary: 'Get artifact download info',
			},
			response: {
				200: DownloadArtifactResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
				503: ErrorResponseSchema,
			},
		},
	);
