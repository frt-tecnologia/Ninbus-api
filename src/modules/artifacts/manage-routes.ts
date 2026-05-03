import { withAuth } from '@common/middleware/auth-guard';
import { checkMembership } from '@common/middleware/company-check';
import {
	ArtifactDeleteResponseSchema,
	ArtifactListResponseSchema,
	ArtifactResponseSchema,
	DownloadLinkResponseSchema,
	ErrorResponseSchema,
	GenericActionResponseSchema,
	ReleaseListResponseSchema,
	updateArtifactSchema,
} from '@modules/artifacts/schemas';
import { Elysia, t } from 'elysia';
import * as service from './service';

/**
 * Artifact management routes — list, get, update, delete, download, releases.
 */
export const artifactManageRoutes = withAuth(
	new Elysia({ prefix: '/api/companies/:companyId/artifacts' }),
)
	// GET / — List artifacts (with Ninbus type enrichment)
	.get(
		'/',
		async ({ params, query, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			const result = await service.listArtifacts({
				page: query?.page,
				perPage: query?.perPage,
				name: query?.name,
			});
			return result;
		},
		{
			auth: true,
			params: t.Object({ companyId: t.String({ format: 'uuid' }) }),
			query: t.Object({
				page: t.Optional(t.Number()),
				perPage: t.Optional(t.Number({ maximum: 500 })),
				name: t.Optional(t.String({ description: 'Filter by artifact name' })),
			}),
			detail: {
				tags: ['Artifacts'],
				summary: 'List OTA artifacts',
				description: 'Lists all firmware artifacts enriched with Ninbus type metadata',
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
				const artifact = await service.getArtifact(params.artifactId);
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
				artifactId: t.String({ description: 'Mender artifact ID' }),
			}),
			detail: {
				tags: ['Artifacts'],
				summary: 'Get artifact details',
				description: 'Artifact metadata enriched with Ninbus type info',
			},
			response: {
				200: ArtifactResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	)

	// GET /:artifactId/download — Get download link
	.get(
		'/:artifactId/download',
		async ({ params, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			try {
				const link = await service.getArtifactDownloadLink(params.artifactId);
				return { data: link };
			} catch {
				set.status = 404;
				return { error: 'Not Found', message: 'Artifact not found' };
			}
		},
		{
			auth: true,
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				artifactId: t.String({ description: 'Mender artifact ID' }),
			}),
			detail: {
				tags: ['Artifacts'],
				summary: 'Get artifact download link',
				description: 'Returns a pre-signed URL for downloading',
			},
			response: {
				200: DownloadLinkResponseSchema,
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
			await service.deleteArtifact(params.artifactId);
			return { message: 'Artifact deleted successfully' };
		},
		{
			auth: true,
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				artifactId: t.String({ description: 'Mender artifact ID' }),
			}),
			detail: { tags: ['Artifacts'], summary: 'Delete artifact' },
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
			await service.updateArtifact(params.artifactId, body.description);
			return { message: 'Artifact updated successfully' };
		},
		{
			auth: true,
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				artifactId: t.String({ description: 'Mender artifact ID' }),
			}),
			body: updateArtifactSchema,
			detail: { tags: ['Artifacts'], summary: 'Update artifact metadata' },
			response: {
				200: GenericActionResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	)

	// GET /releases — List releases
	.get(
		'/releases',
		async ({ params, query, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			const { menderReleases } = await import('@common/mender/client');
			const releases = await menderReleases.list({ page: query?.page, perPage: query?.perPage });
			return { data: releases };
		},
		{
			auth: true,
			params: t.Object({ companyId: t.String({ format: 'uuid' }) }),
			query: t.Object({ page: t.Optional(t.Number()), perPage: t.Optional(t.Number()) }),
			detail: {
				tags: ['Artifacts'],
				summary: 'List releases',
				description: 'Lists all releases (artifact groupings) from Mender',
			},
			response: {
				200: ReleaseListResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	);
