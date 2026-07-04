import { withAuth } from '@common/middleware/auth-guard';
import {
	ErrorResponseSchema,
	MemberDeleteResponseSchema,
	MemberListResponseSchema,
	MemberUpdateResponseSchema,
	designateMemberSchema,
	updateMemberRoleSchema,
} from '@modules/companies/schemas';
import { logActivity } from '@modules/observability/activity-service';
import { Elysia, t } from 'elysia';
import { designateMember } from './designation';
import { LastOwnerError } from './service';
import * as service from './service';

/**
 * Company member management routes.
 *
 * Members are added by EMAIL (not userId). If the user exists, they are added
 * immediately. If not, a pending designation is created and resolved when they
 * sign up — same "factory onboarding" model as company creation.
 *
 * Role requirements:
 * - GET /             → viewer (any member can list)
 * - POST /            → admin (add/designate new members by email)
 * - PUT /:userId      → admin (change roles, cannot demote last owner)
 * - DELETE /:userId   → admin (remove members, cannot remove last owner)
 */
export const companyMemberRoutes = withAuth(
	new Elysia({ prefix: '/api/companies/:companyId/members' }),
)
	// GET — List members (any member can view)
	.get(
		'/',
		async ({ params }) => {
			const members = await service.getCompanyMembers(params.companyId);
			return { data: members, total: members.length };
		},
		{
			auth: true,
			companyRole: 'viewer',
			params: t.Object({ companyId: t.String({ format: 'uuid', description: 'Company ID' }) }),
			detail: {
				tags: ['Companies'],
				summary: 'List company members',
				description: 'Returns all members. Any member can view the member list.',
			},
			response: {
				200: MemberListResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	)

	// POST — Designate/add member by email (admin+)
	.post(
		'/',
		async ({ params, body, user, set }) => {
			const result = await designateMember({
				companyId: params.companyId,
				email: body.email,
				role: body.role,
				createdBy: user.id,
			});

			set.status = 201;
			await logActivity({
				actorUserId: user.id,
				actorEmail: user.email,
				companyId: params.companyId,
				action: 'member.added',
				entityType: 'member',
				entityId: body.email,
				entityLabel: body.email,
				metadata: { role: body.role, granted: result.granted, pending: result.pending },
			});
			return {
				message: result.granted
					? 'Member added successfully'
					: 'Designation created — user will gain access when they sign up',
				data: result,
			};
		},
		{
			auth: true,
			companyRole: 'admin',
			params: t.Object({ companyId: t.String({ format: 'uuid', description: 'Company ID' }) }),
			body: designateMemberSchema,
			detail: {
				tags: ['Companies'],
				summary: 'Add/designate a company member by email',
				description:
					'Adds a member by email. If the user already has an account, they are added ' +
					'immediately with the specified role. If not, a pending designation is created and ' +
					'resolved automatically when they sign up. Requires admin role or above.',
			},
			response: {
				201: t.Object({
					message: t.String(),
					data: t.Object({
						granted: t.Boolean(),
						pending: t.Boolean(),
					}),
				}),
				400: ErrorResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	)

	// PUT /:userId — Update member role (admin+)
	.put(
		'/:userId',
		async ({ params, body, user, set }) => {
			const member = await service.updateMemberRole(params.companyId, params.userId, body.role);
			if (!member) {
				set.status = 404;
				return { error: 'Not Found', message: 'Member not found' };
			}
			await logActivity({
				actorUserId: user.id,
				actorEmail: user.email,
				companyId: params.companyId,
				action: 'member.role_changed',
				entityType: 'member',
				entityId: params.userId,
				entityLabel: params.userId,
				metadata: { newRole: body.role },
			});
			return { message: 'Member role updated successfully', data: member };
		},
		{
			auth: true,
			companyRole: 'admin',
			params: t.Object({
				companyId: t.String({ format: 'uuid', description: 'Company ID' }),
				userId: t.String({ description: 'User ID to update' }),
			}),
			body: updateMemberRoleSchema,
			detail: {
				tags: ['Companies'],
				summary: 'Update member role',
				description: "Changes a member's role. Requires admin role or above.",
			},
			response: {
				200: MemberUpdateResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	)

	// DELETE /:userId — Remove member (admin+)
	.delete(
		'/:userId',
		async ({ params, user, set }) => {
			try {
				await service.removeMember(params.companyId, params.userId);
			} catch (error) {
				if (error instanceof LastOwnerError) {
					set.status = 409;
					return { error: 'Conflict', message: error.message };
				}
				throw error;
			}
			await logActivity({
				actorUserId: user.id,
				actorEmail: user.email,
				companyId: params.companyId,
				action: 'member.removed',
				entityType: 'member',
				entityId: params.userId,
			});
			return { message: 'Member removed successfully' };
		},
		{
			auth: true,
			companyRole: 'admin',
			params: t.Object({
				companyId: t.String({ format: 'uuid', description: 'Company ID' }),
				userId: t.String({ description: 'User ID to remove' }),
			}),
			detail: {
				tags: ['Companies'],
				summary: 'Remove member',
				description:
					'Removes a member from the company. Cannot remove the last owner. ' +
					'Requires admin role or above.',
			},
			response: {
				200: MemberDeleteResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
				409: ErrorResponseSchema,
			},
		},
	);
