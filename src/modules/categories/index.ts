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
import { logActivity } from '@modules/observability/activity-service';
import { Elysia, t } from 'elysia';
import * as service from './service';

/**
 * Categories Module — Device grouping within a company.
 *
 * Role requirements:
 * - GET /              → viewer (list categories)
 * - POST /             → operator (create category)
 * - GET /:id           → viewer (view category)
 * - PUT /:id           → operator (update category)
 * - DELETE /:id        → admin (delete category)
 */
export const categoriesModule = withAuth(
	new Elysia({ prefix: '/api/companies/:companyId/categories' }),
)
	// GET / — List categories
	.get(
		'/',
		async ({ params }) => {
			const cats = await service.getCompanyCategories(params.companyId);
			return { data: cats, total: cats.length };
		},
		{
			auth: true,
			companyRole: 'viewer',
			params: t.Object({ companyId: t.String({ format: 'uuid' }) }),
			detail: { tags: ['Categories'], summary: 'List company categories' },
			response: {
				200: CategoryListResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	)

	// POST / — Create category
	.post(
		'/',
		async ({ params, body, user, set }) => {
			const category = await service.createCategory({
				companyId: params.companyId,
				name: body.name,
				type: body.type,
				description: body.description,
			});
			if (!category) {
				set.status = 500;
				return { error: 'Internal Error', message: 'Failed to create category' };
			}
			await logActivity({
				actorUserId: user.id,
				actorEmail: user.email,
				companyId: params.companyId,
				action: 'category.created',
				entityType: 'category',
				entityId: category.id,
				entityLabel: category.name,
				metadata: { type: body.type },
			});
			set.status = 201;
			return { message: 'Category created successfully', data: category };
		},
		{
			auth: true,
			companyRole: 'operator',
			params: t.Object({ companyId: t.String({ format: 'uuid' }) }),
			body: createCategorySchema,
			detail: {
				tags: ['Categories'],
				summary: 'Create category',
				description: 'Creates a device grouping category. Requires operator role or above.',
			},
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
		async ({ params, set }) => {
			const category = await service.getCategoryById(params.categoryId, params.companyId);
			if (!category) {
				set.status = 404;
				return { error: 'Not Found', message: 'Category not found' };
			}
			return { data: category };
		},
		{
			auth: true,
			companyRole: 'viewer',
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
			const category = await service.updateCategory(params.categoryId, params.companyId, body);
			if (!category) {
				set.status = 404;
				return { error: 'Not Found', message: 'Category not found' };
			}
			await logActivity({
				actorUserId: user.id,
				actorEmail: user.email,
				companyId: params.companyId,
				action: 'category.updated',
				entityType: 'category',
				entityId: params.categoryId,
				entityLabel: category.name,
				metadata: { changes: body },
			});
			return { message: 'Category updated successfully', data: category };
		},
		{
			auth: true,
			companyRole: 'operator',
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				categoryId: t.String({ format: 'uuid' }),
			}),
			body: updateCategorySchema,
			detail: {
				tags: ['Categories'],
				summary: 'Update category',
				description: 'Updates category name or description. Requires operator role or above.',
			},
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
		async ({ params, user }) => {
			const category = await service.getCategoryById(params.categoryId, params.companyId);
			await service.deleteCategory(params.categoryId, params.companyId);
			await logActivity({
				actorUserId: user.id,
				actorEmail: user.email,
				companyId: params.companyId,
				action: 'category.deleted',
				entityType: 'category',
				entityId: params.categoryId,
				entityLabel: category?.name ?? null,
				metadata: { type: category?.type ?? null },
			});
			return { message: 'Category deleted successfully' };
		},
		{
			auth: true,
			companyRole: 'admin',
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				categoryId: t.String({ format: 'uuid' }),
			}),
			detail: {
				tags: ['Categories'],
				summary: 'Delete category',
				description: 'Deletes a category. Requires admin role or above.',
			},
			response: {
				200: CategoryDeleteResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	);
