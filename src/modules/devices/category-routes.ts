import { withAuth } from '@common/middleware/auth-guard';
import { assignCategoriesSchema } from '@modules/devices/schemas';
import { Elysia, t } from 'elysia';
import { checkMembership } from './auth';
import * as service from './service';

const deviceParams = t.Object({
	companyId: t.String({ format: 'uuid' }),
	deviceId: t.String({ format: 'uuid' }),
});

/**
 * Device category assignment routes — N:N relationship.
 */
export const deviceCategoryRoutes = withAuth(
	new Elysia({ prefix: '/api/companies/:companyId/devices' }),
)
	// GET /:deviceId/categories — List device categories
	.get(
		'/:deviceId/categories',
		async ({ params, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			const cats = await service.getDeviceCategories(params.deviceId);
			return { data: cats, total: cats.length };
		},
		{
			auth: true,
			params: deviceParams,
			detail: { tags: ['Devices'], summary: 'List device categories' },
		},
	)

	// PUT /:deviceId/categories — Assign categories to device
	.put(
		'/:deviceId/categories',
		async ({ params, body, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			await service.assignCategories(params.deviceId, body.categoryIds);
			return { message: 'Categories assigned successfully' };
		},
		{
			auth: true,
			params: deviceParams,
			body: assignCategoriesSchema,
			detail: {
				tags: ['Devices'],
				summary: 'Assign categories to device',
				description: 'Replaces all category assignments for a device (N:N relationship)',
			},
		},
	);
