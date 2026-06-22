/**
 * Admin service — platform-level queries for the factory (super admin).
 *
 * These functions aggregate data across ALL companies. They are only called from
 * routes guarded by `superAdmin: true`. They NEVER filter by companyId unless
 * explicitly passed as a parameter.
 */
import { db } from '@common/db';
import { companies, companyMembers, devices, pendingCompanyMembers, user } from '@common/db/schema';
import { isSuperAdmin } from '@common/middleware/auth-guard';
import { desc, eq, sql } from 'drizzle-orm';

/**
 * Lists all companies with member/device/pending counts.
 */
export async function getAllCompaniesWithCounts() {
	const rows = await db
		.select({
			id: companies.id,
			name: companies.name,
			status: companies.status,
			hawkbitTenantId: companies.hawkbitTenantId,
			createdAt: companies.createdAt,
			updatedAt: companies.updatedAt,
			memberCount: sql<number>`COUNT(DISTINCT ${companyMembers.id})`.as('member_count'),
		})
		.from(companies)
		.leftJoin(companyMembers, eq(companies.id, companyMembers.companyId))
		.groupBy(companies.id)
		.orderBy(desc(companies.createdAt));

	// Batch-fetch device counts and pending counts to avoid N+1.
	const deviceCounts = await db
		.select({
			companyId: devices.companyId,
			count: sql<number>`COUNT(*)`.as('cnt'),
		})
		.from(devices)
		.where(sql`${devices.companyId} IS NOT NULL`)
		.groupBy(devices.companyId);

	const pendingCounts = await db
		.select({
			companyId: pendingCompanyMembers.companyId,
			count: sql<number>`COUNT(*)`.as('cnt'),
		})
		.from(pendingCompanyMembers)
		.groupBy(pendingCompanyMembers.companyId);

	const deviceMap = new Map(deviceCounts.map((r) => [r.companyId, Number(r.count)]));
	const pendingMap = new Map(pendingCounts.map((r) => [r.companyId, Number(r.count)]));

	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		status: r.status,
		hawkbitTenantId: r.hawkbitTenantId,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
		memberCount: Number(r.memberCount),
		deviceCount: deviceMap.get(r.id) ?? 0,
		pendingCount: pendingMap.get(r.id) ?? 0,
	}));
}

/**
 * Gets a single company with counts (for admin detail view).
 */
export async function getCompanyWithCounts(companyId: string) {
	const all = await getAllCompaniesWithCounts();
	return all.find((c) => c.id === companyId) ?? null;
}

/**
 * Lists all users with their company count and super-admin flag.
 */
export async function getAllUsersWithCounts() {
	const rows = await db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			emailVerified: user.emailVerified,
			image: user.image,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
			companyCount: sql<number>`COUNT(DISTINCT ${companyMembers.companyId})`.as('company_count'),
		})
		.from(user)
		.leftJoin(companyMembers, eq(user.id, companyMembers.userId))
		.groupBy(user.id)
		.orderBy(desc(user.createdAt));

	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		email: r.email,
		emailVerified: r.emailVerified,
		image: r.image,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
		companyCount: Number(r.companyCount),
		isSuperAdmin: isSuperAdmin(r.email),
	}));
}

/**
 * Lists all devices across all companies (for the admin device inventory).
 */
export async function getAllDevices() {
	return await db
		.select({
			id: devices.id,
			companyId: devices.companyId,
			hawkbitTargetId: devices.hawkbitTargetId,
			name: devices.name,
			serialNumber: devices.serialNumber,
			serialDisplay: devices.serialDisplay,
			status: devices.status,
			connectionStatus: devices.connectionStatus,
			createdAt: devices.createdAt,
			updatedAt: devices.updatedAt,
			lastSeenAt: devices.lastSeenAt,
		})
		.from(devices)
		.orderBy(desc(devices.createdAt));
}
