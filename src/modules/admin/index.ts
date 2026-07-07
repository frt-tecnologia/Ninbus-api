import { withAuth } from '@common/middleware/auth-guard';
import {
	AdminCompanyDetailResponseSchema,
	AdminCompanyListResponseSchema,
	AdminCompanyStatusUpdateSchema,
	AdminDeviceListResponseSchema,
	AdminPendingDesignationListResponseSchema,
	AdminUserListResponseSchema,
	ErrorResponseSchema,
	GenericActionResponseSchema,
} from '@modules/admin/schemas';
import {
	getAllCompaniesWithCounts,
	getAllDevices,
	getAllUsersWithCounts,
	getCompanyWithCounts,
} from '@modules/admin/service';
import { getAllPendingDesignations } from '@modules/companies/designation';
import { getCompanyMembers } from '@modules/companies/service';
import * as companyService from '@modules/companies/service';
import { getCompanyDevices } from '@modules/devices/service';
import { logActivity } from '@modules/observability/activity-service';
import { Elysia, t } from 'elysia';

/**
 * Admin Module — platform-level management for the factory (super admin).
 *
 * ALL routes require `superAdmin: true` (email in SUPER_ADMIN_EMAILS env var).
 * The factory can see and manage ALL companies, users, devices, and designations
 * across the entire platform — regardless of company membership.
 *
 * This is the "controle sobre tudo" layer requested by the client.
 */
export const adminModule = withAuth(new Elysia({ prefix: '/api/admin' }))
	// GET /companies — List ALL companies with counts
	.get(
		'/companies',
		async () => {
			const companies = await getAllCompaniesWithCounts();
			return { data: companies, total: companies.length };
		},
		{
			auth: true,
			superAdmin: true,
			detail: {
				tags: ['Admin'],
				summary: 'List all companies (factory only)',
				description:
					'Returns all companies across the platform with member, device, and pending ' +
					'designation counts. Requires platform super admin (factory) access.',
			},
			response: {
				200: AdminCompanyListResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	)

	// GET /companies/:companyId — Get any company detail with counts
	.get(
		'/companies/:companyId',
		async ({ params, set }) => {
			const company = await getCompanyWithCounts(params.companyId);
			if (!company) {
				set.status = 404;
				return { error: 'Not Found', message: 'Company not found' };
			}
			return { data: company };
		},
		{
			auth: true,
			superAdmin: true,
			params: t.Object({ companyId: t.String({ format: 'uuid' }) }),
			detail: {
				tags: ['Admin'],
				summary: 'Get company detail (factory only)',
				description: 'Returns company details with counts. No membership required — factory only.',
			},
			response: {
				200: AdminCompanyDetailResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	)

	// GET /companies/:companyId/members — Members of ANY company
	.get(
		'/companies/:companyId/members',
		async ({ params }) => {
			const members = await getCompanyMembers(params.companyId);
			return { data: members, total: members.length };
		},
		{
			auth: true,
			superAdmin: true,
			params: t.Object({ companyId: t.String({ format: 'uuid' }) }),
			detail: {
				tags: ['Admin'],
				summary: 'List members of any company (factory only)',
			},
			response: {
				200: t.Object({ data: t.Array(t.Unknown()), total: t.Number() }),
				403: ErrorResponseSchema,
			},
		},
	)

	// GET /companies/:companyId/devices — Devices of ANY company
	.get(
		'/companies/:companyId/devices',
		async ({ params }) => {
			const deviceList = await getCompanyDevices(params.companyId);
			return { data: deviceList, total: deviceList.length };
		},
		{
			auth: true,
			superAdmin: true,
			params: t.Object({ companyId: t.String({ format: 'uuid' }) }),
			detail: {
				tags: ['Admin'],
				summary: 'List devices of any company (factory only)',
			},
			response: { 200: AdminDeviceListResponseSchema, 403: ErrorResponseSchema },
		},
	)

	// PUT /companies/:companyId/status — Suspend or activate ANY company
	.put(
		'/companies/:companyId/status',
		async ({ params, body, user, set }) => {
			const company = await companyService.updateCompany(params.companyId, {
				status: body.status,
			});
			if (!company) {
				set.status = 404;
				return { error: 'Not Found', message: 'Company not found' };
			}
			await logActivity({
				actorUserId: user.id,
				actorEmail: user.email,
				companyId: params.companyId,
				action: body.status === 'suspended' ? 'company.suspended' : 'company.activated',
				entityType: 'company',
				entityId: params.companyId,
				entityLabel: company.name,
			});
			return {
				message: `Company ${body.status === 'suspended' ? 'suspended' : 'activated'} successfully`,
			};
		},
		{
			auth: true,
			superAdmin: true,
			params: t.Object({ companyId: t.String({ format: 'uuid' }) }),
			body: AdminCompanyStatusUpdateSchema,
			detail: {
				tags: ['Admin'],
				summary: 'Suspend or activate a company (factory only)',
				description:
					'Suspended companies block all write operations for their members ' +
					'(devices, categories, deployments). Read access remains. Factory only.',
			},
			response: {
				200: GenericActionResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	)

	// GET /users — List ALL registered users
	.get(
		'/users',
		async () => {
			const users = await getAllUsersWithCounts();
			return { data: users, total: users.length };
		},
		{
			auth: true,
			superAdmin: true,
			detail: {
				tags: ['Admin'],
				summary: 'List all users (factory only)',
				description:
					'Returns all registered users with their company count and super-admin flag. ' +
					'Useful for designating company owners. Factory only.',
			},
			response: {
				200: AdminUserListResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	)

	// GET /devices — List ALL devices across ALL companies
	.get(
		'/devices',
		async () => {
			const deviceList = await getAllDevices();
			return { data: deviceList, total: deviceList.length };
		},
		{
			auth: true,
			superAdmin: true,
			detail: {
				tags: ['Admin'],
				summary: 'List all devices (factory only)',
				description: 'Returns all devices across the platform, including unclaimed ones.',
			},
			response: {
				200: AdminDeviceListResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	)

	// POST /devices/sync — Force a full hawkBit sync (refresh all connection statuses)
	.post(
		'/devices/sync',
		async ({ set }) => {
			const { DeviceSyncEngine } = await import('@modules/devices/sync');
			try {
				const { updated, disabled } = await DeviceSyncEngine.forceSyncAll();
				return {
					message: disabled
						? 'hawkBit integration is disabled — no sync performed.'
						: `Status refreshed. ${updated} device(s) updated.`,
				};
			} catch {
				set.status = 503;
				return { message: 'hawkBit is currently unreachable. Try again in a moment.' };
			}
		},
		{
			auth: true,
			superAdmin: true,
			detail: {
				tags: ['Admin'],
				summary: 'Force-refresh device statuses from hawkBit (factory only)',
				description:
					'Triggers a full sync of every device from hawkBit, updating ' +
					'connectionStatus, lastSeenAt and pollStatus. Use this when the ' +
					'table looks stale (the background sync runs on an interval).',
			},
			response: {
				200: GenericActionResponseSchema,
				403: ErrorResponseSchema,
				503: ErrorResponseSchema,
			},
		},
	)

	// GET /pending-designations — List ALL pending designations
	.get(
		'/pending-designations',
		async () => {
			const designations = await getAllPendingDesignations();
			return { data: designations, total: designations.length };
		},
		{
			auth: true,
			superAdmin: true,
			detail: {
				tags: ['Admin'],
				summary: 'List all pending designations (factory only)',
				description:
					'Returns all pending (unclaimed) member designations across the platform. ' +
					'Factory can see which emails are waiting to sign up.',
			},
			response: {
				200: AdminPendingDesignationListResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	);
