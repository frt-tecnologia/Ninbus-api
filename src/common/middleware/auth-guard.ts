import {
	CAPABILITIES,
	type Capability,
	hasCapability,
	normalizeRole,
} from '@common/auth/capabilities';
import { auth } from '@common/config/auth';
import { env } from '@common/config/env';
import { db } from '@common/db';
import { companies, companyMembers, companyRolePolicies } from '@common/db/schema';
import { serializeSignedCookie } from 'better-call';
import { and, eq } from 'drizzle-orm';
import type { Elysia } from 'elysia';

/** Role hierarchy for company-scoped RBAC (RBAC v2): owner > manager > operator > observer. */
const ROLE_HIERARCHY: Record<string, number> = {
	owner: 4,
	manager: 3,
	operator: 2,
	observer: 1,
} as const;

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
			let sessionHeaders = request.headers;

			// Bearer token support (mobile/API clients)
			// The bearer plugin hooks only run during auth.handler() pipeline,
			// not during direct auth.api.getSession() calls — so we convert here.
			const authHeader = request.headers.get('authorization');
			if (authHeader?.startsWith('Bearer ')) {
				const token = authHeader.slice(7);
				// If already signed (contains dot), use as-is; otherwise sign it
				const signedToken = token.includes('.')
					? token
					: (await serializeSignedCookie('', token, env.BETTER_AUTH_SECRET!)).replace('=', '');
				const newHeaders = new Headers(request.headers);
				newHeaders.append('cookie', `auth.session_token=${signedToken}`);
				sessionHeaders = newHeaders;
			}

			const session = await auth.api.getSession({
				headers: sessionHeaders,
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
			 * Capability check — RBAC v2. Resolves the caller's role in
			 * :companyId, merges factory defaults with the company's override
			 * policy (company_role_policies, super-admin edited) and requires
			 * the given capability. Super admins bypass.
			 *
			 * Usage: { auth: true, requireCapability: 'devices.delete' }
			 */
			requireCapability(capability: string) {
				if (!capability) return;

				return {
					resolve: async ({ user, params }: any) => {
						if (!user || !params?.companyId) {
							return { companyPermissions: undefined };
						}
						if (isSuperAdmin(user.email)) {
							return { companyPermissions: new Set(CAPABILITIES) };
						}
						const [row] = await db
							.select({ role: companyMembers.role })
							.from(companyMembers)
							.where(
								and(
									eq(companyMembers.companyId, params.companyId),
									eq(companyMembers.userId, user.id),
								),
							);
						if (!row) return { companyPermissions: undefined };

						const role = normalizeRole(row.role) ?? 'observer';
						const [policy] = await db
							.select({ overrides: companyRolePolicies.overrides })
							.from(companyRolePolicies)
							.where(
								and(
									eq(companyRolePolicies.companyId, params.companyId),
									eq(companyRolePolicies.role, row.role),
								),
							);

						return {
							companyPermissions: hasCapability(
								role,
								capability as Capability,
								policy?.overrides ?? null,
							)
								? new Set(CAPABILITIES)
								: null,
							companyRole: row.role as string,
						};
					},
					beforeHandle: async ({ user, params, set, companyPermissions }: any) => {
						if (!user) {
							set.status = 401;
							return { error: 'Unauthorized', message: 'Authentication required' };
						}
						if (!params?.companyId) {
							set.status = 400;
							return { error: 'Bad Request', message: 'Company ID is required' };
						}
						if (companyPermissions === undefined) {
							set.status = 403;
							return { error: 'Forbidden', message: 'You are not a member of this company' };
						}
						if (companyPermissions === null) {
							set.status = 403;
							return {
								error: 'Forbidden',
								message: `Missing capability: '${capability}'`,
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

						// Super admins bypass membership check — get owner role for any company
						if (isSuperAdmin(user.email)) {
							return {
								companyRole: 'owner',
								companyId: params.companyId,
							};
						}

						const [membership] = await db
							.select({
								role: companyMembers.role,
								companyId: companyMembers.companyId,
								companyStatus: companies.status,
							})
							.from(companyMembers)
							.innerJoin(companies, eq(companyMembers.companyId, companies.id))
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
							companyStatus: membership.companyStatus,
						};
					},
					beforeHandle: async ({
						user,
						params,
						set,
						request,
						companyRole: derivedRole,
						companyStatus,
						_membershipDenied,
					}: any) => {
						if (!user) {
							set.status = 401;
							return { error: 'Unauthorized', message: 'Authentication required' };
						}

						if (!params?.companyId) {
							set.status = 400;
							return { error: 'Bad Request', message: 'Company ID is required' };
						}

						// Super admins bypass all company role checks
						if (isSuperAdmin(user.email)) return;

						if (_membershipDenied) {
							set.status = 403;
							return { error: 'Forbidden', message: 'You are not a member of this company' };
						}

						// Suspended companies block write operations (GET is always allowed for members).
						if (companyStatus === 'suspended' && request.method !== 'GET') {
							set.status = 403;
							return {
								error: 'Forbidden',
								message: 'This company is suspended. Write operations are blocked.',
							};
						}

						if (!derivedRole) return;

						const role = normalizeRole(derivedRole) ?? 'observer';
						const minimum = normalizeRole(minimumRole) ?? minimumRole;
						const userLevel = ROLE_HIERARCHY[role];
						const requiredLevel = ROLE_HIERARCHY[minimum] ?? 0;

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
