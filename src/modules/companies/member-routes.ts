import { withAuth } from '@common/middleware/auth-guard';
import { checkMembership } from '@common/middleware/company-check';
import {
	ErrorResponseSchema,
	MemberAddResponseSchema,
	MemberDeleteResponseSchema,
	MemberListResponseSchema,
	MemberUpdateResponseSchema,
	addMemberSchema,
	updateMemberRoleSchema,
} from '@modules/companies/schemas';
import { Elysia, t } from 'elysia';
import * as service from './service';

/**
 * Company member management routes.
 */
export const companyMemberRoutes = withAuth(
	new Elysia({ prefix: '/api/companies/:companyId/members' }),
)
	// GET — List members
	.get(
		'/',
		async ({ params, user, set }) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			const members = await service.getCompanyMembers(params.companyId);
			return { data: members, total: members.length };
		},
		{
			auth: true,
			params: t.Object({ companyId: t.String({ format: 'uuid', description: 'Company ID' }) }),
			detail: {
				tags: ['Companies'],
				summary: 'List company members',
				description: 'Returns all members (requires membership)',
			},
			response: {
				200: MemberListResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	)

	// POST — Add member
	.post(
		'/',
		async ({ params, body, user, set }) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			const member = await service.addCompanyMember({
				companyId: params.companyId,
				userId: body.userId,
				role: body.role,
			});
			set.status = 201;
			return { message: 'Member added successfully', data: member };
		},
		{
			auth: true,
			params: t.Object({ companyId: t.String({ format: 'uuid', description: 'Company ID' }) }),
			body: addMemberSchema,
			detail: {
				tags: ['Companies'],
				summary: 'Add company member',
				description: 'Adds a user to the company with specified role',
			},
			response: {
				201: MemberAddResponseSchema,
				400: ErrorResponseSchema,
				403: ErrorResponseSchema,
				409: ErrorResponseSchema,
			},
		},
	)

	// PUT /:userId — Update member role
	.put(
		'/:userId',
		async ({ params, body, user, set }) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			const member = await service.updateMemberRole(params.companyId, params.userId, body.role);
			if (!member) {
				set.status = 404;
				return { error: 'Not Found', message: 'Member not found' };
			}
			return { message: 'Member role updated successfully', data: member };
		},
		{
			auth: true,
			params: t.Object({
				companyId: t.String({ format: 'uuid', description: 'Company ID' }),
				userId: t.String({ description: 'User ID to update' }),
			}),
			body: updateMemberRoleSchema,
			detail: { tags: ['Companies'], summary: 'Update member role' },
			response: {
				200: MemberUpdateResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	)

	// DELETE /:userId — Remove member
	.delete(
		'/:userId',
		async ({ params, user, set }) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			await service.removeMember(params.companyId, params.userId);
			return { message: 'Member removed successfully' };
		},
		{
			auth: true,
			params: t.Object({
				companyId: t.String({ format: 'uuid', description: 'Company ID' }),
				userId: t.String({ description: 'User ID to remove' }),
			}),
			detail: { tags: ['Companies'], summary: 'Remove member' },
			response: {
				200: MemberDeleteResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	);
