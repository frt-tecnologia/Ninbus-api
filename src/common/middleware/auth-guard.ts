import { db } from '@common/db';
import { companyMembers } from '@common/db/schema';
import { and, eq } from 'drizzle-orm';
import { auth } from '@common/config/auth';
import type { Elysia } from 'elysia';

/**
 * Role hierarchy for company-scoped RBAC.
 * owner (4) > admin (3) > operator (2) > viewer (1)
 */
const ROLE_HIERARCHY: Record<string, number> = {
	owner: 4,
	admin: 3,
	operator: 2,
	viewer: 1,
} as const;

type CompanyRole = keyof typeof ROLE_HIERARCHY;

/**
 * Derives user and session from Better Auth.
 * Call this in your module before defining routes.
 *
 * Provides two macros:
 * - `auth: true` — requires authentication (401 if not)
 * - `companyRole: 'operator'` — requires auth + company membership + minimum role (401/403)
 *
 * On success, derives `companyRole` and `companyId` into the route context.
 */
export function withAuth<T extends Elysia<any, any, any, any, any, any, any>>(app: T) {
	return app
		.derive(async ({ request }) => {
			const session = await auth.api.getSession({
				headers: request.headers,
			});

			return {
				user: session?.user ?? null,
				session: session?.session ?? null,
			};
		})
		.macro({
			auth(enabled: boolean) {
				if (!enabled) return;

				return {
					beforeHandle: async ({ user, set }: any) => {
						if (!user) {
							set.status = 401;
							return {
								error: 'Unauthorized',
								message: 'Please login first',
							};
						}
					},
				};
			},
			/**
			 * Company-scoped role check.
			 * Requires `auth: true` to be set alongside this.
			 * Checks `params.companyId` for membership and role level.
			 *
			 * Usage:
			 *   { auth: true, companyRole: 'operator' }
			 *
			 * On success, derives `companyRole` and `companyId` into context.
			 */
			companyRole(minimumRole: string) {
				if (!minimumRole) return;

				return {
					resolve: async ({ user, params }: any) => {
						// Skip if no user (auth macro will handle 401)
						if (!user || !params?.companyId) {
							return { companyRole: undefined, companyId: undefined };
						}

						const [membership] = await db
							.select({
								role: companyMembers.role,
								companyId: companyMembers.companyId,
							})
							.from(companyMembers)
							.where(
								and(
									eq(companyMembers.companyId, params.companyId),
									eq(companyMembers.userId, user.id),
								),
							);

						if (!membership) {
							return { companyRole: undefined, companyId: undefined, _membershipDenied: true };
						}

						return {
							companyRole: membership.role,
							companyId: membership.companyId,
						};
					},
					beforeHandle: async ({ user, params, set, companyRole: derivedRole, _membershipDenied }: any) => {
						if (!user) {
							set.status = 401;
							return { error: 'Unauthorized', message: 'Authentication required' };
						}

						if (!params?.companyId) {
							set.status = 400;
							return { error: 'Bad Request', message: 'Company ID is required' };
						}

						if (_membershipDenied) {
							set.status = 403;
							return { error: 'Forbidden', message: 'You are not a member of this company' };
						}

						if (!derivedRole) return;

						const userLevel = ROLE_HIERARCHY[derivedRole as CompanyRole] ?? 0;
						const requiredLevel = ROLE_HIERARCHY[minimumRole as CompanyRole] ?? 0;

						if (userLevel < requiredLevel) {
							set.status = 403;
							return {
								error: 'Forbidden',
								message: `Role '${derivedRole}' is insufficient. Minimum required: '${minimumRole}'`,
							};
						}
						// Returns undefined = passes to handler
					},
				};
			},
		});
}
