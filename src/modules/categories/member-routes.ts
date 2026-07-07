import { withAuth } from '@common/middleware/auth-guard';
import {
	CategoryDeviceRemoveResponseSchema,
	CategoryDevicesActionResponseSchema,
	CategoryDevicesListResponseSchema,
	ErrorResponseSchema,
	addDevicesToCategorySchema,
} from '@modules/categories/schemas';
import * as categoryService from '@modules/categories/service';
import { logActivity } from '@modules/observability/activity-service';
import { Elysia, t } from 'elysia';

/**
 * Category members (devices) routes — N:N device↔category management.
 *
 * These endpoints let the Flutter frontend manage devices INSIDE a group:
 *  - list members (GET)
 *  - add members in bulk (POST — idempotent)
 *  - replace all members (PUT)
 *  - remove a single member (DELETE)
 *
 * Role requirements:
 * - GET    /:categoryId/devices             → viewer (read)
 * - POST   /:categoryId/devices             → operator (add members)
 * - PUT    /:categoryId/devices             → operator (replace members)
 * - DELETE /:categoryId/devices/:deviceId   → operator (remove a member)
 *
 * NOTE: removing a device from a category is NOT a destructive operation
 * on the group itself — it's a category assignment change. Operators can do it.
 * Deleting the WHOLE group still requires admin (see index.ts).
 */
export const categoryMemberRoutes = withAuth(
	new Elysia({ prefix: '/api/companies/:companyId/categories' }),
)
	// GET /:categoryId/devices — list devices in this category
	.get(
		'/:categoryId/devices',
		async ({ params, set }) => {
			// Verify category exists & belongs to company (404 otherwise).
			const category = await categoryService.getCategoryById(params.categoryId, params.companyId);
			if (!category) {
				set.status = 404;
				return { error: 'Not Found', message: 'Category not found' };
			}
			const members = await categoryService.getCategoryDevices(params.categoryId, params.companyId);
			return { data: members, total: members.length };
		},
		{
			auth: true,
			companyRole: 'viewer',
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				categoryId: t.String({ format: 'uuid' }),
			}),
			detail: {
				tags: ['Categories'],
				summary: 'List devices in a category',
				description:
					'Returns all devices (members) assigned to a category, scoped to the company. ' +
					'Each member includes `assignedAt` (when it was added to the group). Requires viewer role or above.',
			},
			response: {
				200: CategoryDevicesListResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	)

	// POST /:categoryId/devices — add members (idempotent bulk)
	.post(
		'/:categoryId/devices',
		async ({ params, body, user, set }) => {
			const category = await categoryService.getCategoryById(params.categoryId, params.companyId);
			if (!category) {
				set.status = 404;
				return { error: 'Not Found', message: 'Category not found' };
			}
			const result = await categoryService.addDevicesToCategory(
				params.categoryId,
				params.companyId,
				body.deviceIds,
			);
			await logActivity({
				actorUserId: user.id,
				actorEmail: user.email,
				companyId: params.companyId,
				action: 'category.updated',
				entityType: 'category',
				entityId: params.categoryId,
				entityLabel: category.name,
				metadata: { added: body.deviceIds, count: result.assigned },
			});
			return {
				message: 'Devices added to category successfully',
				data: result,
			};
		},
		{
			auth: true,
			companyRole: 'operator',
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				categoryId: t.String({ format: 'uuid' }),
			}),
			body: addDevicesToCategorySchema,
			detail: {
				tags: ['Categories'],
				summary: 'Add devices to a category (idempotent)',
				description:
					'Adds one or more devices as members of a category. ' +
					'Already-members are skipped (idempotent). Only devices belonging to the same ' +
					'company may be added — cross-tenant deviceIds are silently dropped. ' +
					'Requires operator role or above.',
			},
			response: {
				200: CategoryDevicesActionResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	)

	// PUT /:categoryId/devices — replace ALL members
	.put(
		'/:categoryId/devices',
		async ({ params, body, user, set }) => {
			const category = await categoryService.getCategoryById(params.categoryId, params.companyId);
			if (!category) {
				set.status = 404;
				return { error: 'Not Found', message: 'Category not found' };
			}
			const result = await categoryService.setCategoryDevices(
				params.categoryId,
				params.companyId,
				body.deviceIds,
			);
			await logActivity({
				actorUserId: user.id,
				actorEmail: user.email,
				companyId: params.companyId,
				action: 'category.updated',
				entityType: 'category',
				entityId: params.categoryId,
				entityLabel: category.name,
				metadata: { replacedWith: body.deviceIds, count: result.assigned },
			});
			return {
				message: 'Category members updated successfully',
				data: result,
			};
		},
		{
			auth: true,
			companyRole: 'operator',
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				categoryId: t.String({ format: 'uuid' }),
			}),
			body: addDevicesToCategorySchema,
			detail: {
				tags: ['Categories'],
				summary: 'Replace all members of a category',
				description:
					'Replaces the full list of devices assigned to a category with the given deviceIds. ' +
					'Devices not in the list are removed from the category; devices in the list are added. ' +
					'Only same-company deviceIds are kept. Requires operator role or above.',
			},
			response: {
				200: CategoryDevicesActionResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	)

	// DELETE /:categoryId/devices/:deviceId — remove a single member
	.delete(
		'/:categoryId/devices/:deviceId',
		async ({ params, user, set }) => {
			// Verify category exists & belongs to company (404 otherwise).
			const category = await categoryService.getCategoryById(params.categoryId, params.companyId);
			if (!category) {
				set.status = 404;
				return { error: 'Not Found', message: 'Category not found' };
			}
			const result = await categoryService.removeDeviceFromCategory(
				params.categoryId,
				params.companyId,
				params.deviceId,
			);
			await logActivity({
				actorUserId: user.id,
				actorEmail: user.email,
				companyId: params.companyId,
				action: 'device.category_changed',
				entityType: 'device',
				entityId: params.deviceId,
				metadata: { removedFrom: params.categoryId, categoryLabel: category.name },
			});
			return {
				message: 'Device removed from category successfully',
				data: result,
			};
		},
		{
			auth: true,
			companyRole: 'operator',
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
				categoryId: t.String({ format: 'uuid' }),
				deviceId: t.String({ format: 'uuid' }),
			}),
			detail: {
				tags: ['Categories'],
				summary: 'Remove a device from a category',
				description:
					'Removes a single device (member) from a category. The device stays in the company ' +
					'and in any other categories. Returns removed=1 on success, removed=0 if the device ' +
					'was not a member. Requires operator role or above.',
			},
			response: {
				200: CategoryDeviceRemoveResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	);
