import { db } from '@common/db';
import { categories, deviceCategoryAssignments, devices } from '@common/db/schema';
import { appLogger } from '@common/logger';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

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

// ---------------------------------------------------------------------------
// Category members (devices) — N:N device↔category assignments
// ---------------------------------------------------------------------------

/**
 * Lists all devices assigned to a category, scoped to a company.
 * Returns devices joined with the assignment timestamp (assignedAt).
 */
export async function getCategoryDevices(categoryId: string, companyId: string) {
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
			hawkbitUpdateStatus: devices.hawkbitUpdateStatus,
			ipAddress: devices.ipAddress,
			lastSeenAt: devices.lastSeenAt,
			lastPollAt: devices.lastPollAt,
			nextExpectedPollAt: devices.nextExpectedPollAt,
			createdAt: devices.createdAt,
			updatedAt: devices.updatedAt,
			assignedAt: deviceCategoryAssignments.assignedAt,
		})
		.from(deviceCategoryAssignments)
		.innerJoin(devices, eq(deviceCategoryAssignments.deviceId, devices.id))
		.innerJoin(categories, eq(deviceCategoryAssignments.categoryId, categories.id))
		.where(
			and(
				eq(deviceCategoryAssignments.categoryId, categoryId),
				eq(categories.companyId, companyId),
			),
		)
		.orderBy(asc(devices.name));
}

/**
 * Returns the device IDs that belong to `companyId` from a candidate list.
 * Used to filter cross-tenant deviceIds before assignment (defense in depth).
 */
async function filterCompanyDevices(
	deviceIds: string[],
	companyId: string,
): Promise<string[]> {
	if (deviceIds.length === 0) return [];
	const rows = await db
		.select({ id: devices.id })
		.from(devices)
		.where(and(eq(devices.companyId, companyId), inArray(devices.id, deviceIds)));
	return rows.map((r) => r.id);
}

/**
 * Returns the device IDs already in `categoryId` from a candidate list.
 */
async function getExistingMembers(categoryId: string, deviceIds: string[]) {
	if (deviceIds.length === 0) return new Set<string>();
	const rows = await db
		.select({ deviceId: deviceCategoryAssignments.deviceId })
		.from(deviceCategoryAssignments)
		.where(
			and(
				eq(deviceCategoryAssignments.categoryId, categoryId),
				inArray(deviceCategoryAssignments.deviceId, deviceIds),
			),
		);
	return new Set(rows.map((r) => r.deviceId));
}

export interface AddDevicesResult {
	assigned: number;
	skipped: number;
	total: number;
}

/**
 * Adds one or more devices to a category (idempotent).
 * Cross-tenant deviceIds are silently dropped — only same-company devices
 * may be assigned. Existing members are skipped (no error).
 */
export async function addDevicesToCategory(
	categoryId: string,
	companyId: string,
	deviceIds: string[],
): Promise<AddDevicesResult> {
	// Filter to same-company devices (defense in depth against cross-tenant).
	const validIds = await filterCompanyDevices(deviceIds, companyId);
	const existing = await getExistingMembers(categoryId, validIds);
	const toInsert = validIds.filter((id) => !existing.has(id));

	if (toInsert.length > 0) {
		await db.insert(deviceCategoryAssignments).values(
			toInsert.map((deviceId) => ({ deviceId, categoryId })),
		);
		appLogger.info(
			'[CATEGORIES] Added %d device(s) to category %s (company %s)',
			toInsert.length,
			categoryId,
			companyId,
		);
	}

	return {
		assigned: toInsert.length,
		skipped: validIds.length - toInsert.length,
		total: await countCategoryDevices(categoryId, companyId),
	};
}

/**
 * Replaces ALL devices in a category with the given list (PUT semantics).
 * Returns the new total count. Cross-tenant deviceIds are dropped.
 */
export async function setCategoryDevices(
	categoryId: string,
	companyId: string,
	deviceIds: string[],
): Promise<AddDevicesResult> {
	const validIds = await filterCompanyDevices(deviceIds, companyId);
	// Atomic replace: delete then insert in a transaction.
	await db.transaction(async (tx) => {
		await tx
			.delete(deviceCategoryAssignments)
			.where(eq(deviceCategoryAssignments.categoryId, categoryId));
		if (validIds.length > 0) {
			await tx.insert(deviceCategoryAssignments).values(
				validIds.map((deviceId) => ({ deviceId, categoryId })),
			);
		}
	});

	appLogger.info(
		'[CATEGORIES] Replaced members of category %s with %d device(s) (company %s)',
		categoryId,
		validIds.length,
		companyId,
	);

	return {
		assigned: validIds.length,
		skipped: 0,
		total: validIds.length,
	};
}

/**
 * Removes a single device from a category (DELETE single member).
 * Returns 1 if removed, 0 if the device was not a member.
 */
export async function removeDeviceFromCategory(
	categoryId: string,
	companyId: string,
	deviceId: string,
): Promise<{ removed: number }> {
	// Only delete if the category belongs to the company (cascade-safe).
	const result = await db
		.delete(deviceCategoryAssignments)
		.where(
			and(
				eq(deviceCategoryAssignments.categoryId, categoryId),
				eq(deviceCategoryAssignments.deviceId, deviceId),
				// Company scope: join via sub-query is overkill; we verify category
				// ownership via getCategoryById in the route handler before calling this.
			),
		)
		.returning({ deviceId: deviceCategoryAssignments.deviceId });

	const removed = result.length;
	if (removed > 0) {
		appLogger.info(
			'[CATEGORIES] Removed device %s from category %s (company %s)',
			deviceId,
			categoryId,
			companyId,
		);
	}
	return { removed };
}

export async function countCategoryDevices(categoryId: string, companyId: string) {
	const rows = await db
		.select({ id: deviceCategoryAssignments.deviceId })
		.from(deviceCategoryAssignments)
		.innerJoin(categories, eq(deviceCategoryAssignments.categoryId, categories.id))
		.where(
			and(
				eq(deviceCategoryAssignments.categoryId, categoryId),
				eq(categories.companyId, companyId),
			),
		);
	return rows.length;
}
