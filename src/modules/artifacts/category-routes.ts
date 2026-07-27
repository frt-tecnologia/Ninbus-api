import { withAuth } from '@common/middleware/auth-guard';
import {
	ArtifactCategoryAssignResponseSchema,
	ArtifactCategoryListResponseSchema,
	ErrorResponseSchema,
	assignArtifactCategoriesSchema,
} from '@modules/artifacts/schemas';
import { logActivity } from '@modules/observability/activity-service';
import { Elysia, t } from 'elysia';
import * as categoryService from './category-service';
import { ArtifactNotFoundError } from './types';

const artifactParams = t.Object({
	companyId: t.String({ format: 'uuid' }),
	artifactId: t.String({ description: 'hawkBit Software Module ID' }),
});

const artifactCategoryParams = t.Object({
	companyId: t.String({ format: 'uuid' }),
	artifactId: t.String({ description: 'hawkBit Software Module ID' }),
	categoryId: t.String({ format: 'uuid' }),
});

/**
 * Artifact category (grouping) routes — N:N, LOCAL ONLY (no hawkBit calls).
 *
 * Role requirements:
 * - GET    /:artifactId/categories               → viewer (read)
 * - PATCH  /:artifactId/categories               → operator (replace all groups)
 * - DELETE /:artifactId/categories/:categoryId   → operator (remove one group)
 */
export const artifactCategoryRoutes = withAuth(
	new Elysia({ prefix: '/api/companies/:companyId/artifacts' }),
)
	// GET /:artifactId/categories — List artifact groups
	.get(
		'/:artifactId/categories',
		async ({ params, set }) => {
			try {
				const cats = await categoryService.getArtifactCategories(
					params.companyId,
					Number(params.artifactId),
				);
				return { data: cats, total: cats.length };
			} catch (error) {
				if (error instanceof ArtifactNotFoundError) {
					set.status = 404;
					return { error: 'Not Found', message: error.message };
				}
				throw error;
			}
		},
		{
			auth: true,
			companyRole: 'viewer',
			params: artifactParams,
			detail: { tags: ['Artifacts'], summary: 'List artifact groups (categories)' },
			response: {
				200: ArtifactCategoryListResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	)

	// PATCH /:artifactId/categories — Replace all groups (idempotent)
	.patch(
		'/:artifactId/categories',
		async ({ params, body, user, set }) => {
			try {
				const result = await categoryService.assignArtifactCategories(
					params.companyId,
					Number(params.artifactId),
					body.categoryIds,
				);
				await logActivity({
					actorUserId: user.id,
					actorEmail: user.email,
					companyId: params.companyId,
					action: 'device.category_changed',
					entityType: 'artifact',
					entityId: params.artifactId,
					metadata: { assigned: result.assigned, dropped: result.dropped },
				});
				return { message: 'Artifact groups updated successfully', ...result };
			} catch (error) {
				if (error instanceof ArtifactNotFoundError) {
					set.status = 404;
					return { error: 'Not Found', message: error.message };
				}
				throw error;
			}
		},
		{
			auth: true,
			companyRole: 'operator',
			params: artifactParams,
			body: assignArtifactCategoriesSchema,
			detail: {
				tags: ['Artifacts'],
				summary: 'Assign groups (categories) to artifact',
				description:
					'Replaces the full set of groups for an artifact (N:N, idempotent). ' +
					'Only categoryIds belonging to this company are kept; cross-tenant ids are silently dropped. ' +
					'Local only — does not touch hawkBit. Requires operator role or above.',
			},
			response: {
				200: ArtifactCategoryAssignResponseSchema,
				400: ErrorResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	)

	// DELETE /:artifactId/categories/:categoryId — Remove a single group
	.delete(
		'/:artifactId/categories/:categoryId',
		async ({ params, set }) => {
			try {
				await categoryService.removeArtifactCategory(
					params.companyId,
					Number(params.artifactId),
					params.categoryId,
				);
				return { message: 'Group removed from artifact' };
			} catch (error) {
				if (error instanceof ArtifactNotFoundError) {
					set.status = 404;
					return { error: 'Not Found', message: error.message };
				}
				throw error;
			}
		},
		{
			auth: true,
			companyRole: 'operator',
			params: artifactCategoryParams,
			detail: { tags: ['Artifacts'], summary: 'Remove a single group from artifact' },
			response: {
				200: t.Object({ message: t.String() }),
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	);
