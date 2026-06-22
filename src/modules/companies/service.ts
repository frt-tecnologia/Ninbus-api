import { db } from '@common/db';
import { companies, companyMembers } from '@common/db/schema';
import { appLogger } from '@common/logger';
import { and, desc, eq } from 'drizzle-orm';
import { designateMember } from './designation';

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

/**
 * Creates a company and designates the owner by email.
 * If the owner's user account already exists, they are added immediately.
 * Otherwise, a pending designation is created and resolved when they sign up.
 */
export async function createCompany(data: {
	name: string;
	ownerEmail: string;
	createdBy: string;
}) {
	const [company] = await db.insert(companies).values({ name: data.name }).returning();
	if (!company) throw new Error('Failed to create company');

	// Designate the owner by email (grants immediately if user exists, else pending).
	await designateMember({
		companyId: company.id,
		email: data.ownerEmail,
		role: 'owner',
		createdBy: data.createdBy,
	});

	appLogger.info(
		'[COMPANY] Created company %s (%s), owner designated: %s',
		company.id,
		data.name,
		data.ownerEmail,
	);

	return company;
}

export async function updateCompany(companyId: string, data: { name?: string; status?: string }) {
	const [company] = await db
		.update(companies)
		.set({ ...data, updatedAt: new Date() } as any)
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

/**
 * Removes a member. Throws if the member is the last owner of the company.
 */
export async function removeMember(companyId: string, userId: string): Promise<void> {
	// Check if this member is an owner.
	const [target] = await db
		.select({ role: companyMembers.role })
		.from(companyMembers)
		.where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)));

	if (target?.role === 'owner') {
		const ownerCount = await countCompanyOwners(companyId);
		if (ownerCount <= 1) {
			throw new LastOwnerError('Cannot remove the last owner of a company');
		}
	}

	await db
		.delete(companyMembers)
		.where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)));
}

/** Custom error for last-owner protection — caught in the route handler. */
export class LastOwnerError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'LastOwnerError';
	}
}

/** Counts how many owners a company has. */
export async function countCompanyOwners(companyId: string): Promise<number> {
	const owners = await db
		.select({ id: companyMembers.id })
		.from(companyMembers)
		.where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.role, 'owner')));
	return owners.length;
}

export async function isCompanyMember(companyId: string, userId: string): Promise<boolean> {
	const [member] = await db
		.select({ id: companyMembers.id })
		.from(companyMembers)
		.where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)));
	return !!member;
}
