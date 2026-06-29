import { ErrorResponseSchema, GenericActionResponseSchema, dateTimeString } from '@common/schemas';
import { t } from 'elysia';

/** Company shape with counts — used by the admin company list. */
export const AdminCompanySchema = t.Object({
	id: t.String({ format: 'uuid' }),
	name: t.String(),
	status: t.String(),
	hawkbitTenantId: t.Union([t.String(), t.Null()]),
	createdAt: dateTimeString,
	updatedAt: dateTimeString,
	memberCount: t.Number(),
	deviceCount: t.Number(),
	pendingCount: t.Number(),
});

export const AdminCompanyListResponseSchema = t.Object({
	data: t.Array(AdminCompanySchema),
	total: t.Number(),
});

export const AdminCompanyDetailResponseSchema = t.Object({
	data: AdminCompanySchema,
});

export const AdminCompanyStatusUpdateSchema = t.Object(
	{
		status: t.Union([t.Literal('active'), t.Literal('suspended')], {
			description: 'New company status',
		}),
	},
	{ default: { status: 'suspended' } },
);

/** User shape with company count — used by the admin user list. */
export const AdminUserSchema = t.Object({
	id: t.String(),
	name: t.String(),
	email: t.String(),
	emailVerified: t.Boolean(),
	image: t.Union([t.String(), t.Null()]),
	createdAt: dateTimeString,
	updatedAt: dateTimeString,
	companyCount: t.Number(),
	isSuperAdmin: t.Boolean(),
});

export const AdminUserListResponseSchema = t.Object({
	data: t.Array(AdminUserSchema),
	total: t.Number(),
});

export const AdminDeviceSchema = t.Object({
	id: t.String({ format: 'uuid' }),
	companyId: t.Union([t.String({ format: 'uuid' }), t.Null()]),
	hawkbitTargetId: t.Union([t.String(), t.Null()]),
	name: t.String(),
	serialNumber: t.Union([t.String(), t.Null()]),
	serialDisplay: t.Union([t.String(), t.Null()]),
	status: t.String(),
	connectionStatus: t.Union([t.String(), t.Null()]),
	createdAt: dateTimeString,
	updatedAt: dateTimeString,
	lastSeenAt: t.Union([dateTimeString, t.Null()]),
});

export const AdminDeviceListResponseSchema = t.Object({
	data: t.Array(AdminDeviceSchema),
	total: t.Number(),
});

export const AdminPendingDesignationSchema = t.Object({
	id: t.String({ format: 'uuid' }),
	companyId: t.String({ format: 'uuid' }),
	companyName: t.String(),
	email: t.String(),
	role: t.String(),
	claimedAt: t.Union([dateTimeString, t.Null()]),
	createdAt: dateTimeString,
});

export const AdminPendingDesignationListResponseSchema = t.Object({
	data: t.Array(AdminPendingDesignationSchema),
	total: t.Number(),
});

export { ErrorResponseSchema, GenericActionResponseSchema };
