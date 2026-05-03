import { withAuth } from '@common/middleware/auth-guard';
import {
	CategoryCreateResponseSchema,
	CategoryDeleteResponseSchema,
	CategoryListResponseSchema,
	CategoryResponseSchema,
	CategoryUpdateResponseSchema,
	ErrorResponseSchema,
	createCategorySchema,
	updateCategorySchema,
} from '@modules/categories/schemas';
import { isCompanyMember } from '@modules/companies/service';
import { Elysia, t } from 'elysia';
import * as service from './service';

/**
 * Categories Module — Device grouping categories.
 * Categories belong to companies and group devices for fleet management.
 */
export const categoriesModule = withAuth(
	new Elysia({ prefix: '/api/companies/:companyId/categories' }),
)
	// GET — List categories
	.get(
		'/',
		async ({ params, user, set }) => {
			const memberCheck = await isCompanyMember(params.companyId, user.id);
			if (!memberCheck) {
				set.status = 403;
				return { error: 'Forbidden', message: 'Not a member of this company' };
			}
			const cats = await service.getCompanyCategories(params.companyId);
			return { data: cats, total: cats.length };
		},
		{
			auth: true,
			params: t.Object({ companyId: t.String({ format: 'uuid' }) }),
			detail: { tags: ['Categories'], summary: 'List company categories' },
			response: {
				200: CategoryListResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	)

	// POST — Create category
	.post(
		'/',
		async ({ params, body, user, set }) => {
			const memberCheck = await isCompanyMember(params.companyId, user.id);
			if (!memberCheck) {
				set.status = 403;
				return { error: 'Forbidden', message: 'Not a member of this company' };
			}
			const category = await service.createCategory({
				companyId: params.companyId,
				...body,
			});
			set.status = 201;
			return { message: 'Category created successfully', data: category };
		},
		{
			auth: true,
			params: t.Object({ companyId: t.String({ format: 'uuid' }) }),
			body: createCategorySchema,
			detail: { tags: ['Categories'], summary: 'Create category' },
			response: {
				201: CategoryCreateResponseSchema,
				400: ErrorResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	)

	// GET /:categoryId — Get category
	.get(
		'/:categoryId',
		async ({ params, user, set }) => {
			const memberCheck = await isCompanyMember(params.companyId, user.id);
			if (!memberCheck) {
				set.status = 403;
				return { error: 'Forbidden', message: 'Not a member of this company' };
			}
			const category = await service.getCategoryById(params.categoryId, params.companyId);
			if (!category) {
				set.status = 404;
				return { error: 'Not Found', message: 'Category not found' };
			}
			return { data: category };
		},
		{
			auth: true,
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				categoryId: t.String({ format: 'uuid' }),
			}),
			detail: { tags: ['Categories'], summary: 'Get category by ID' },
			response: {
				200: CategoryResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	)

	// PUT /:categoryId — Update category
	.put(
		'/:categoryId',
		async ({ params, body, user, set }) => {
			const memberCheck = await isCompanyMember(params.companyId, user.id);
			if (!memberCheck) {
				set.status = 403;
				return { error: 'Forbidden', message: 'Not a member of this company' };
			}
			const category = await service.updateCategory(params.categoryId, params.companyId, body);
			if (!category) {
				set.status = 404;
				return { error: 'Not Found', message: 'Category not found' };
			}
			return { message: 'Category updated successfully', data: category };
		},
		{
			auth: true,
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				categoryId: t.String({ format: 'uuid' }),
			}),
			body: updateCategorySchema,
			detail: { tags: ['Categories'], summary: 'Update category' },
			response: {
				200: CategoryUpdateResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	)

	// DELETE /:categoryId — Delete category
	.delete(
		'/:categoryId',
		async ({ params, user, set }) => {
			const memberCheck = await isCompanyMember(params.companyId, user.id);
			if (!memberCheck) {
				set.status = 403;
				return { error: 'Forbidden', message: 'Not a member of this company' };
			}
			await service.deleteCategory(params.categoryId, params.companyId);
			return { message: 'Category deleted successfully' };
		},
		{
			auth: true,
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				categoryId: t.String({ format: 'uuid' }),
			}),
			detail: { tags: ['Categories'], summary: 'Delete category' },
			response: {
				200: CategoryDeleteResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	);
