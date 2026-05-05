import { db } from '@common/db';
import { companies, companyMembers } from '@common/db/schema';
import { and, desc, eq } from 'drizzle-orm';

export async function getUserCompanies(userId: string) {
	return await db
		.select({
			id: companies.id,
			name: companies.name,
			status: companies.status,
			hawkbitTenantId: companies.hawkbitTenantId,
			role: companyMembers.role,
			createdAt: companies.createdAt,
			updatedAt: companies.updatedAt,
		})
		.from(companyMembers)
		.innerJoin(companies, eq(companyMembers.companyId, companies.id))
		.where(eq(companyMembers.userId, userId))
		.orderBy(desc(companies.createdAt));
}

export async function getCompanyById(companyId: string) {
	const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
	return company;
}

export async function createCompany(data: { name: string; ownerId: string }) {
	const [company] = await db.insert(companies).values({ name: data.name }).returning();
	if (!company) throw new Error('Failed to create company');

	// Add creator as owner
	await db.insert(companyMembers).values({
		userId: data.ownerId,
		companyId: company.id,
		role: 'owner',
	});

	return company;
}

export async function updateCompany(companyId: string, data: { name?: string }) {
	const [company] = await db
		.update(companies)
		.set({ ...data, updatedAt: new Date() })
		.where(eq(companies.id, companyId))
		.returning();
	return company;
}

export async function deleteCompany(companyId: string) {
	await db.delete(companies).where(eq(companies.id, companyId));
}

export async function getCompanyMembers(companyId: string) {
	return await db
		.select({
			id: companyMembers.id,
			userId: companyMembers.userId,
			companyId: companyMembers.companyId,
			role: companyMembers.role,
			createdAt: companyMembers.createdAt,
		})
		.from(companyMembers)
		.where(eq(companyMembers.companyId, companyId));
}

export async function addCompanyMember(data: {
	companyId: string;
	userId: string;
	role: string;
}) {
	// Check if already a member
	const [existing] = await db
		.select()
		.from(companyMembers)
		.where(
			and(eq(companyMembers.companyId, data.companyId), eq(companyMembers.userId, data.userId)),
		);

	if (existing) {
		// Update role instead
		const [member] = await db
			.update(companyMembers)
			.set({ role: data.role as any })
			.where(eq(companyMembers.id, existing.id))
			.returning();
		return member;
	}

	const [member] = await db
		.insert(companyMembers)
		.values(data as any)
		.returning();
	return member;
}

export async function updateMemberRole(companyId: string, userId: string, role: string) {
	const [member] = await db
		.update(companyMembers)
		.set({ role: role as any })
		.where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)))
		.returning();
	return member;
}

export async function removeMember(companyId: string, userId: string) {
	await db
		.delete(companyMembers)
		.where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)));
}

export async function isCompanyMember(companyId: string, userId: string): Promise<boolean> {
	const [member] = await db
		.select({ id: companyMembers.id })
		.from(companyMembers)
		.where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)));
	return !!member;
}
