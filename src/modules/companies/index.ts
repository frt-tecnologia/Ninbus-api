import { withAuth } from '@common/middleware/auth-guard';
import {
	CompanyCreateResponseSchema,
	CompanyDeleteResponseSchema,
	CompanyListResponseSchema,
	CompanyResponseSchema,
	CompanyUpdateResponseSchema,
	CreateCompanyBodySchema,
	ErrorResponseSchema,
	UpdateCompanyBodySchema,
} from '@modules/companies/schemas';
import { Elysia, t } from 'elysia';
import * as service from './service';

/**
 * Companies Module — Multi-tenancy management.
 *
 * Role requirements:
 * - GET /            → viewer (any member)
 * - POST /           → any authenticated user (creates company as owner)
 * - GET /:id         → viewer (any member)
 * - PUT /:id         → admin (rename, status changes)
 * - DELETE /:id      → owner (destructive operation)
 */
export const companiesModule = withAuth(new Elysia({ prefix: '/api/companies' }))
	// GET / — List user's companies
	.get(
		'/',
		async ({ user }) => {
			const companies = await service.getUserCompanies(user.id);
			return { data: companies, total: companies.length };
		},
		{
			auth: true,
			detail: {
				tags: ['Companies'],
				summary: 'List user companies',
				description: 'All companies the authenticated user belongs to',
			},
			response: {
				200: CompanyListResponseSchema,
			},
		},
	)

	// POST / — Create company (any authenticated user becomes owner)
	.post(
		'/',
		async ({ body, user, set }) => {
			const company = await service.createCompany({ name: body.name, ownerId: user.id });
			set.status = 201;
			return { message: 'Company created successfully', data: company };
		},
		{
			auth: true,
			body: CreateCompanyBodySchema,
			detail: {
				tags: ['Companies'],
				summary: 'Create company',
				description: 'Creates a new company with the authenticated user as owner',
			},
			response: {
				201: CompanyCreateResponseSchema,
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
			},
		},
	)

	// GET /:companyId — Get company (any member)
	.get(
		'/:companyId',
		async ({ params, set }) => {
			const company = await service.getCompanyById(params.companyId);
			if (!company) {
				set.status = 404;
				return { error: 'Not Found', message: 'Company not found' };
			}
			return { data: company };
		},
		{
			auth: true,
			companyRole: 'viewer',
			params: t.Object({ companyId: t.String({ format: 'uuid', description: 'Company ID' }) }),
			detail: {
				tags: ['Companies'],
				summary: 'Get company by ID',
				description: 'Returns company details (requires membership)',
			},
			response: {
				200: CompanyResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	)

	// PUT /:companyId — Update company (admin+)
	.put(
		'/:companyId',
		async ({ params, body, set }) => {
			const company = await service.updateCompany(params.companyId, body);
			if (!company) {
				set.status = 404;
				return { error: 'Not Found', message: 'Company not found' };
			}
			return { message: 'Company updated successfully', data: company };
		},
		{
			auth: true,
			companyRole: 'admin',
			params: t.Object({ companyId: t.String({ format: 'uuid', description: 'Company ID' }) }),
			body: UpdateCompanyBodySchema,
			detail: {
				tags: ['Companies'],
				summary: 'Update company',
				description: 'Updates company name or status. Requires admin role or above.',
			},
			response: {
				200: CompanyUpdateResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	)

	// DELETE /:companyId — Delete company (owner only)
	.delete(
		'/:companyId',
		async ({ params }) => {
			await service.deleteCompany(params.companyId);
			return { message: 'Company deleted successfully' };
		},
		{
			auth: true,
			companyRole: 'owner',
			params: t.Object({ companyId: t.String({ format: 'uuid', description: 'Company ID' }) }),
			detail: {
				tags: ['Companies'],
				summary: 'Delete company',
				description: 'Deletes a company and all associated data. Owner only.',
			},
			response: {
				200: CompanyDeleteResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	);
