import { companies, companyMembers } from '@common/db/schema';
import { dateTimeString, ErrorResponseSchema } from '@common/schemas';
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-typebox';
import { t } from 'elysia';

export const createCompanySchema = createInsertSchema(companies, {
	name: t.String({ minLength: 1, maxLength: 255, description: 'Company name' }),
});

export const updateCompanySchema = createUpdateSchema(companies, {
	name: t.Optional(t.String({ minLength: 1, maxLength: 255, description: 'Company name' })),
});

export const CreateCompanyBodySchema = t.Omit(
	createCompanySchema,
	['id', 'status', 'createdAt', 'updatedAt'],
	{
		default: {
			name: 'Viação Exemplo S.A.',
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

export const selectCompanySchema = createSelectSchema(companies, {
	createdAt: dateTimeString,
	updatedAt: dateTimeString,
});
export const selectMemberSchema = createSelectSchema(companyMembers, {
	createdAt: dateTimeString,
});

export const CompanyResponseSchema = t.Object({
	data: selectCompanySchema,
});

export const CompanyListResponseSchema = t.Object({
	data: t.Array(selectCompanySchema),
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

export { ErrorResponseSchema };
