import {
	CAPABILITIES,
	COMPANY_ROLES,
	ROLE_DEFAULTS,
	resolvePermissions,
} from '@common/auth/capabilities';
import { db } from '@common/db';
import { companyRolePolicies } from '@common/db/schema';
import { withAuth } from '@common/middleware/auth-guard';
import { ErrorResponseSchema, GenericActionResponseSchema } from '@common/schemas';
import { eq } from 'drizzle-orm';
import { Elysia, t } from 'elysia';

/** RBAC v2 — per-company role permission policies (platform super admin). */
export const adminRbacModule = new Elysia({ prefix: '/api/admin/companies/:companyId' })
	.use(withAuth)

	.get(
		'/role-policies',
		async ({ params }) => {
			const policies = await db
				.select({ role: companyRolePolicies.role, overrides: companyRolePolicies.overrides })
				.from(companyRolePolicies)
				.where(eq(companyRolePolicies.companyId, params.companyId));
			const byRole = new Map(policies.map((row) => [row.role, row.overrides]));
			return {
				data: COMPANY_ROLES.map((role) => {
					const overrides = byRole.get(role) ?? {};
					return {
						role,
						defaults: [...ROLE_DEFAULTS[role]],
						overrides,
						effective: [...resolvePermissions(role, overrides)],
					};
				}),
			};
		},
		{
			auth: true,
			superAdmin: true,
			params: t.Object({ companyId: t.String({ format: 'uuid' }) }),
			detail: {
				tags: ['Admin'],
				summary: 'Company role permission matrix (factory only)',
				description:
					'Effective capabilities per company role: factory defaults merged with the ' +
					"company's overrides (PUT).",
			},
			response: { 200: t.Object({ data: t.Array(t.Unknown()) }), 403: ErrorResponseSchema },
		},
	)

	.put(
		'/role-policies',
		async ({ params, body, user }) => {
			const overrides: Record<string, boolean> = {};
			for (const [capability, allowed] of Object.entries(body.overrides)) {
				if (!CAPABILITIES.includes(capability as never)) {
					throw new Error(`Unknown capability: ${capability}`);
				}
				overrides[capability] = allowed;
			}
			await db
				.insert(companyRolePolicies)
				.values({
					companyId: params.companyId,
					role: body.role,
					overrides,
					updatedBy: user.id,
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [companyRolePolicies.companyId, companyRolePolicies.role],
					set: { overrides, updatedBy: user.id, updatedAt: new Date() },
				});
			return { message: 'Role policy saved' };
		},
		{
			auth: true,
			superAdmin: true,
			params: t.Object({ companyId: t.String({ format: 'uuid' }) }),
			body: t.Object({
				role: t.Enum({
					owner: 'owner',
					manager: 'manager',
					operator: 'operator',
					observer: 'observer',
				}),
				overrides: t.Record(t.String(), t.Boolean()),
			}),
			detail: {
				tags: ['Admin'],
				summary: "Upsert a company role's permission overrides (factory only)",
				description: 'Replaces the override map for one role. Empty map = factory defaults.',
			},
			response: {
				200: GenericActionResponseSchema,
				400: ErrorResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	);
