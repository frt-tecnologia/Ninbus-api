import { withAuth } from '@common/middleware/auth-guard';
import {
	DesignationDeleteResponseSchema,
	DesignationListResponseSchema,
	ErrorResponseSchema,
} from '@modules/companies/schemas';
import { logActivity } from '@modules/observability/activity-service';
import { Elysia, t } from 'elysia';
import { getPendingDesignations, revokePendingDesignation } from './designation';

/**
 * Company designation routes — manage pending (unclaimed) member designations.
 *
 * These let company admins see who has been designated but hasn't signed up yet,
 * and revoke those designations before they're claimed.
 *
 * Role requirements:
 * - GET /:companyId/designations     → admin (list pending designations)
 * - DELETE /:companyId/designations/:id → admin (revoke unclaimed designation)
 */
export const designationRoutes = withAuth(
	new Elysia({ prefix: '/api/companies/:companyId/designations' }),
)
	// GET — List pending designations (admin+)
	.get(
		'/',
		async ({ params }) => {
			const designations = await getPendingDesignations(params.companyId);
			return { data: designations, total: designations.length };
		},
		{
			auth: true,
			companyRole: 'admin',
			params: t.Object({
				companyId: t.String({ format: 'uuid', description: 'Company ID' }),
			}),
			detail: {
				tags: ['Companies'],
				summary: 'List pending member designations',
				description:
					'Returns all unclaimed member designations (users who have been designated ' +
					"by email but haven't signed up yet). Requires admin role or above.",
			},
			response: {
				200: DesignationListResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	)

	// DELETE /:id — Revoke a pending designation (admin+)
	.delete(
		'/:designationId',
		async ({ params, user, set }) => {
			const revoked = await revokePendingDesignation(params.companyId, params.designationId);
			if (!revoked) {
				set.status = 404;
				return {
					error: 'Not Found',
					message: 'Designation not found or already claimed',
				};
			}
			await logActivity({
				actorUserId: user.id,
				actorEmail: user.email,
				companyId: params.companyId,
				action: 'designation.cancelled',
				entityType: 'designation',
				entityId: params.designationId,
				entityLabel: revoked.email,
			});
			return { message: 'Designation revoked successfully' };
		},
		{
			auth: true,
			companyRole: 'admin',
			params: t.Object({
				companyId: t.String({ format: 'uuid', description: 'Company ID' }),
				designationId: t.String({ format: 'uuid', description: 'Designation ID to revoke' }),
			}),
			detail: {
				tags: ['Companies'],
				summary: 'Revoke a pending designation',
				description:
					'Revokes an unclaimed designation so the designated email no longer gains ' +
					'access on sign-up. Claimed designations cannot be revoked (retained for audit). ' +
					'Requires admin role or above.',
			},
			response: {
				200: DesignationDeleteResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	);
