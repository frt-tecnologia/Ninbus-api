import { db } from '@common/db';
import { companyMembers } from '@common/db/schema';
import { and, eq } from 'drizzle-orm';
import type { Elysia } from 'elysia';

/**
 * Company authorization middleware.
 * Verifies that the authenticated user is a member of the specified company
 * and has sufficient role for the requested action.
 *
 * Role hierarchy: owner > admin > operator > viewer
 */
const ROLE_HIERARCHY: Record<string, number> = {
	owner: 4,
	admin: 3,
	operator: 2,
	viewer: 1,
};

export function hasCompanyRole(minimumRole: string) {
	return (app: Elysia) =>
		app.derive(async ({ params, user, set }: any) => {
			if (!user) {
				set.status = 401;
				return { error: 'Unauthorized', message: 'Authentication required' };
			}

			const companyId = params.companyId;
			if (!companyId) {
				set.status = 400;
				return { error: 'Bad Request', message: 'Company ID is required' };
			}

			const [membership] = await db
				.select({
					role: companyMembers.role,
					companyId: companyMembers.companyId,
					userId: companyMembers.userId,
				})
				.from(companyMembers)
				.where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, user.id)));

			if (!membership) {
				set.status = 403;
				return { error: 'Forbidden', message: 'You are not a member of this company' };
			}

			const userLevel = ROLE_HIERARCHY[membership.role] ?? 0;
			const requiredLevel = ROLE_HIERARCHY[minimumRole] ?? 0;

			if (userLevel < requiredLevel) {
				set.status = 403;
				return {
					error: 'Forbidden',
					message: `Role '${membership.role}' is insufficient. Minimum required: '${minimumRole}'`,
				};
			}

			return {
				companyRole: membership.role,
				companyId: membership.companyId,
			};
		});
}
