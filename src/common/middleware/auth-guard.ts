import { db } from '@common/db';
import { companyMembers } from '@common/db/schema';
import { and, eq } from 'drizzle-orm';
import { auth } from '@common/config/auth';
import { env } from '@common/config/env';
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
 * Checks if a user email is in the SUPER_ADMIN_EMAILS env list.
 * Platform-level admin — can manage ALL companies, devices, and users.
 * This is NOT a company-scoped role; it's a system-wide privilege.
 */
export function isSuperAdmin(email: string | null | undefined): boolean {
	if (!email) return false;
	return env.SUPER_ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(email.toLowerCase());
}

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
			 * Platform-level super admin check.
			 * Requires `auth: true` alongside this.
			 * Checks if user.email is in SUPER_ADMIN_EMAILS env list.
			 * Returns 403 if user is not a platform super admin.
			 *
			 * Usage:
			 *   { auth: true, superAdmin: true }
			 */
			superAdmin(enabled: boolean) {
				if (!enabled) return;

				return {
					beforeHandle: async ({ user, set }: any) => {
						if (!user) {
							set.status = 401;
							return { error: 'Unauthorized', message: 'Please login first' };
						}
						if (!isSuperAdmin(user.email)) {
							set.status = 403;
							return {
								error: 'Forbidden',
								message: 'Platform admin access required',
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
