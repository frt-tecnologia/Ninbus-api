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
import { logActivity } from '@modules/observability/activity-service';
import { Elysia, t } from 'elysia';
import { resolvePendingMembers } from './designation';
import * as service from './service';

/**
 * Companies Module — Multi-tenancy management.
 *
 * Company creation is restricted to the factory (super admin). The factory
 * designates the company owner by email — if the owner's user account exists,
 * they gain access immediately; otherwise a pending designation is created and
 * resolved automatically when they sign up.
 *
 * Role requirements:
 * - GET /            → viewer (any member)
 * - POST /           → super admin (factory) — creates company + designates owner
 * - GET /:id         → viewer (any member)
 * - PUT /:id         → admin (rename, status changes)
 * - DELETE /:id      → owner (destructive operation)
 */
export const companiesModule = withAuth(new Elysia({ prefix: '/api/companies' }))
	// GET / — List user companies (resolves any pending designations first)
	.get(
		'/',
		async ({ user }) => {
			// Safety net: resolve pending designations for this user's email.
			// Normally handled by the Better Auth user.create.after hook, but this
			// covers the edge case where the hook failed or the designation was
			// created after the user signed up.
			if (user?.email) {
				await resolvePendingMembers(user.email, user.id);
			}

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

	// POST / — Create company (FACTORY / super admin only)
	.post(
		'/',
		async ({ body, user, set }) => {
			const company = await service.createCompany({
				name: body.name,
				ownerEmail: body.ownerEmail,
				createdBy: user.id,
			});
			await logActivity({
				actorUserId: user.id,
				actorEmail: user.email,
				companyId: company.id,
				action: 'company.created',
				entityType: 'company',
				entityId: company.id,
				entityLabel: company.name,
				metadata: { ownerEmail: body.ownerEmail },
			});
			set.status = 201;
			return { message: 'Company created successfully', data: company };
		},
		{
			auth: true,
			superAdmin: true,
			body: CreateCompanyBodySchema,
			detail: {
				tags: ['Companies'],
				summary: 'Create company (factory/super admin only)',
				description:
					'Creates a new company and designates the owner by email. ' +
					'If the owner already has an account, they are added as owner immediately. ' +
					'Otherwise a pending designation is created and resolved when they sign up. ' +
					'Requires platform super admin (factory) access.',
			},
			response: {
				201: CompanyCreateResponseSchema,
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				403: ErrorResponseSchema,
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
		async ({ params, body, user, set }) => {
			const company = await service.updateCompany(params.companyId, body);
			if (!company) {
				set.status = 404;
				return { error: 'Not Found', message: 'Company not found' };
			}
			await logActivity({
				actorUserId: user.id,
				actorEmail: user.email,
				companyId: params.companyId,
				action: 'company.updated',
				entityType: 'company',
				entityId: params.companyId,
				entityLabel: company.name,
				metadata: { changes: body },
			});
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
		async ({ params, user }) => {
			const company = await service.getCompanyById(params.companyId);
			await service.deleteCompany(params.companyId);
			await logActivity({
				actorUserId: user.id,
				actorEmail: user.email,
				companyId: params.companyId,
				action: 'company.deleted',
				entityType: 'company',
				entityId: params.companyId,
				entityLabel: company?.name ?? null,
			});
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
