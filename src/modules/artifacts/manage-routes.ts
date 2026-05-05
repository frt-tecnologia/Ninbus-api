import { withAuth } from '@common/middleware/auth-guard';
import { checkMembership } from '@common/middleware/company-check';
import {
	ArtifactDeleteResponseSchema,
	ArtifactListResponseSchema,
	ArtifactResponseSchema,
	DownloadArtifactResponseSchema,
	ErrorResponseSchema,
	GenericActionResponseSchema,
	updateArtifactSchema,
} from '@modules/artifacts/schemas';
import { Elysia, t } from 'elysia';
import * as service from './service';

/**
 * Artifact management routes — list, get, update, delete, download.
 */
export const artifactManageRoutes = withAuth(
	new Elysia({ prefix: '/api/companies/:companyId/artifacts' }),
)
	// GET / — List software modules (artifacts)
	.get(
		'/',
		async ({ params, query, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			const result = await service.listArtifacts({
				offset: query?.offset,
				limit: query?.limit,
			});
			return result;
		},
		{
			auth: true,
			params: t.Object({ companyId: t.String({ format: 'uuid' }) }),
			query: t.Object({
				offset: t.Optional(t.Number()),
				limit: t.Optional(t.Number({ maximum: 500 })),
			}),
			detail: {
				tags: ['Artifacts'],
				summary: 'List OTA artifacts (Software Modules)',
				description: 'Lists all software modules from hawkBit enriched with Ninbus type metadata',
			},
			response: {
				200: ArtifactListResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	)

	// GET /:artifactId — Get artifact details
	.get(
		'/:artifactId',
		async ({ params, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			try {
				const artifact = await service.getArtifact(Number(params.artifactId));
				return { data: artifact };
			} catch {
				set.status = 404;
				return { error: 'Not Found', message: 'Artifact not found' };
			}
		},
		{
			auth: true,
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
			},
		},
	)

	// DELETE /:artifactId — Delete artifact
	.delete(
		'/:artifactId',
		async ({ params, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			await service.deleteArtifact(Number(params.artifactId));
			return { message: 'Artifact deleted successfully' };
		},
		{
			auth: true,
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				artifactId: t.String({ description: 'hawkBit Software Module ID' }),
			}),
			detail: { tags: ['Artifacts'], summary: 'Delete artifact (Software Module)' },
			response: {
				200: ArtifactDeleteResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	)

	// PUT /:artifactId — Update artifact metadata
	.put(
		'/:artifactId',
		async ({ params, body, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			await service.updateArtifact(Number(params.artifactId), body.description);
			return { message: 'Artifact updated successfully' };
		},
		{
			auth: true,
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				artifactId: t.String({ description: 'hawkBit Software Module ID' }),
			}),
			body: updateArtifactSchema,
			detail: { tags: ['Artifacts'], summary: 'Update artifact metadata' },
			response: {
				200: GenericActionResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	)

	// GET /:artifactId/download — Get artifact download info
	.get(
		'/:artifactId/download',
		async ({ params, query, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			try {
				const downloadInfo = await service.getArtifactDownloadUrl(
					Number(params.artifactId),
					Number(query?.artifactFileId ?? 0),
				);
				return { data: downloadInfo };
			} catch {
				set.status = 404;
				return { error: 'Not Found', message: 'Artifact not found' };
			}
		},
		{
			auth: true,
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
			},
		},
	);
