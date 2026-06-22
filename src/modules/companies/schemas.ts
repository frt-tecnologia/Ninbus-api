import { companies, companyMembers, pendingCompanyMembers } from '@common/db/schema';
import { ErrorResponseSchema, dateTimeString } from '@common/schemas';
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-typebox';
import { t } from 'elysia';

export const createCompanySchema = createInsertSchema(companies, {
	name: t.String({ minLength: 1, maxLength: 255, description: 'Company name' }),
});

export const updateCompanySchema = createUpdateSchema(companies, {
	name: t.Optional(t.String({ minLength: 1, maxLength: 255, description: 'Company name' })),
});

/**
 * Body for creating a company (factory/super admin only).
 * The ownerEmail designates the first owner — they gain access when they sign up
 * with that email (or immediately if they already exist).
 */
export const CreateCompanyBodySchema = t.Object(
	{
		name: t.String({ minLength: 1, maxLength: 255, description: 'Company name' }),
		ownerEmail: t.String({
			format: 'email',
			description:
				'Email of the designated company owner. If the user already exists, ' +
				'they are added as owner immediately. Otherwise, a pending designation is ' +
				'created and resolved automatically when they sign up.',
		}),
	},
	{
		default: {
			name: 'Viação Exemplo S.A.',
			ownerEmail: 'dono@viaçãoexemplo.com.br',
		},
	},
);

export const UpdateCompanyBodySchema = t.Omit(
	updateCompanySchema,
	['id', 'status', 'createdAt', 'updatedAt'],
	{
		default: {
			name: 'Viação Exemplo S.A. (Atualizada)',
		},
	},
);

export const addMemberSchema = t.Object(
	{
		userId: t.String({ minLength: 1, description: 'User ID to add as member' }),
		role: t.Union(
			[t.Literal('owner'), t.Literal('admin'), t.Literal('operator'), t.Literal('viewer')],
			{ description: 'Role for the new member' },
		),
	},
	{
		default: {
			userId: 'user-id-exemplo-uuid',
			role: 'admin',
		},
	},
);

export const updateMemberRoleSchema = t.Object(
	{
		role: t.Union(
			[t.Literal('owner'), t.Literal('admin'), t.Literal('operator'), t.Literal('viewer')],
			{ description: 'New role for the member' },
		),
	},
	{
		default: {
			role: 'operator',
		},
	},
);

/**
 * Body for designating a member by email (company admin or factory).
 * The user is added immediately if they exist; otherwise a pending designation
 * is created and resolved on sign-up.
 */
export const designateMemberSchema = t.Object(
	{
		email: t.String({ format: 'email', description: 'Email of the user to designate' }),
		role: t.Union(
			[t.Literal('owner'), t.Literal('admin'), t.Literal('operator'), t.Literal('viewer')],
			{ description: 'Role to assign (or update if already a member)' },
		),
	},
	{
		default: {
			email: 'operador@exemplo.com.br',
			role: 'operator',
		},
	},
);

export const selectCompanySchema = createSelectSchema(companies, {
	createdAt: dateTimeString,
	updatedAt: dateTimeString,
});
export const selectMemberSchema = createSelectSchema(companyMembers, {
	createdAt: dateTimeString,
});
export const selectPendingSchema = createSelectSchema(pendingCompanyMembers, {
	createdAt: dateTimeString,
	updatedAt: dateTimeString,
	claimedAt: t.Union([dateTimeString, t.Null()]),
});

export const CompanyResponseSchema = t.Object({
	data: selectCompanySchema,
});

/** Company list item — includes the user's role in each company. */
export const CompanyListItemSchema = t.Object({
	id: t.String({ format: 'uuid' }),
	name: t.String(),
	status: t.String(),
	hawkbitTenantId: t.Union([t.String(), t.Null()]),
	role: t.String({
		description: 'The authenticated user role in this company (owner/admin/operator/viewer)',
	}),
	createdAt: dateTimeString,
	updatedAt: dateTimeString,
});

export const CompanyListResponseSchema = t.Object({
	data: t.Array(CompanyListItemSchema),
	total: t.Number(),
});

export const CompanyCreateResponseSchema = t.Object({
	message: t.String(),
	data: selectCompanySchema,
});

export const CompanyUpdateResponseSchema = t.Object({
	message: t.String(),
	data: selectCompanySchema,
});

export const CompanyDeleteResponseSchema = t.Object({
	message: t.String(),
});

export const MemberResponseSchema = t.Object({
	data: selectMemberSchema,
});

export const MemberListResponseSchema = t.Object({
	data: t.Array(selectMemberSchema),
});

export const MemberAddResponseSchema = t.Object({
	message: t.String(),
	data: selectMemberSchema,
});

export const MemberUpdateResponseSchema = t.Object({
	message: t.String(),
	data: selectMemberSchema,
});

export const MemberDeleteResponseSchema = t.Object({
	message: t.String(),
});

/** Response for designating a member by email. */
export const DesignationResponseSchema = t.Object({
	message: t.String(),
	data: t.Object({
		granted: t.Boolean({ description: 'True if the role was granted immediately (user exists)' }),
		pending: t.Boolean({
			description: 'True if a pending designation was created (user does not exist yet)',
		}),
	}),
});

export const DesignationListResponseSchema = t.Object({
	data: t.Array(selectPendingSchema),
});

export const DesignationDeleteResponseSchema = t.Object({
	message: t.String(),
});

export { ErrorResponseSchema };
