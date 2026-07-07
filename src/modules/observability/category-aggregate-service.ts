/**
 * Category aggregate service — cross-company view for the super-admin dashboard.
 *
 * Groups device categories (garage / bus_line / region / yard / custom) across
 * ALL companies with live device counts. Used by the "Groups" section of the
 * company observability page.
 */
import { db } from '@common/db';
import { categories } from '@common/db/schema';
import { and, desc, eq, sql } from 'drizzle-orm';

export interface AggregatedCategory {
	id: string;
	companyId: string;
	companyName: string | null;
	name: string;
	type: string;
	description: string | null;
	deviceCount: number;
	createdAt: Date;
}

export interface ListAggregatedCategoriesFilters {
	companyId?: string;
	type?: string;
}

/**
 * List categories across companies with device counts. When `companyId` is
 * provided, restricts to that company (otherwise spans the whole platform).
 */
export async function listAggregatedCategories(
	filters: ListAggregatedCategoriesFilters = {},
): Promise<AggregatedCategory[]> {
	const conditions = [];
	if (filters.companyId) conditions.push(eq(categories.companyId, filters.companyId));
	if (filters.type) conditions.push(eq(categories.type, filters.type as any));

	const rows = await db
		.select({
			id: categories.id,
			companyId: categories.companyId,
			companyName: sql<string | null>`companies.name`,
			name: categories.name,
			type: categories.type,
			description: categories.description,
			deviceCount: sql<number>`(
				SELECT COUNT(*)::int FROM device_category_assignments dca
				WHERE dca.category_id = ${categories.id}
			)`,
			createdAt: categories.createdAt,
		})
		.from(categories)
		.innerJoin(sql`companies`, eq(categories.companyId, sql`companies.id`))
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.orderBy(desc(categories.createdAt));

	return rows as AggregatedCategory[];
}
