import { db } from '@common/db';
import { categories } from '@common/db/schema';
import { and, desc, eq } from 'drizzle-orm';

export async function getCompanyCategories(companyId: string) {
	return await db
		.select()
		.from(categories)
		.where(eq(categories.companyId, companyId))
		.orderBy(desc(categories.createdAt));
}

export async function getCategoryById(categoryId: string, companyId: string) {
	const [category] = await db
		.select()
		.from(categories)
		.where(and(eq(categories.id, categoryId), eq(categories.companyId, companyId)));
	return category;
}

export async function createCategory(data: {
	companyId: string;
	name: string;
	type: string;
	description?: string;
}) {
	const [category] = await db
		.insert(categories)
		.values(data as any)
		.returning();
	return category;
}

export async function updateCategory(
	categoryId: string,
	companyId: string,
	data: { name?: string; description?: string },
) {
	const [category] = await db
		.update(categories)
		.set({ ...data, updatedAt: new Date() })
		.where(and(eq(categories.id, categoryId), eq(categories.companyId, companyId)))
		.returning();
	return category;
}

export async function deleteCategory(categoryId: string, companyId: string) {
	await db
		.delete(categories)
		.where(and(eq(categories.id, categoryId), eq(categories.companyId, companyId)));
}
