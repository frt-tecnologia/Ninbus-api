import { db } from '@common/db';
import { categories, deviceCategoryAssignments, devices } from '@common/db/schema';
import { type HawkbitTarget, hawkbitTargets } from '@common/hawkbit/client';
import { appLogger } from '@common/logger';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DeviceSyncEngine } from './sync';

// ---------------------------------------------------------------------------
// Device CRUD (local DB)
// ---------------------------------------------------------------------------

export async function getCompanyDevices(companyId: string) {
	await DeviceSyncEngine.syncCompany(companyId);

	return await db
		.select()
		.from(devices)
		.where(eq(devices.companyId, companyId))
		.orderBy(desc(devices.createdAt));
}

export async function getDeviceById(deviceId: string, companyId: string) {
	const [device] = await db
		.select()
		.from(devices)
		.where(and(eq(devices.id, deviceId), eq(devices.companyId, companyId)));

	if (device?.status === 'pending') {
		await DeviceSyncEngine.syncCompany(companyId);
		const [updated] = await db
			.select()
			.from(devices)
			.where(and(eq(devices.id, deviceId), eq(devices.companyId, companyId)));
		return updated || device;
	}

	return device;
}

export async function registerDevice(data: {
	companyId: string;
	name: string;
	serialNumber?: string;
	hawkbitTargetId?: string;
	userId: string;
}) {
	const [device] = await db
		.insert(devices)
		.values({
			companyId: data.companyId,
			name: data.name,
			serialNumber: data.serialNumber,
			hawkbitTargetId: data.hawkbitTargetId,
			status: data.hawkbitTargetId ? 'accepted' : 'pending',
			createdBy: data.userId,
		})
		.returning();

	if (device && device.status === 'pending') {
		await DeviceSyncEngine.syncCompany(data.companyId);
		const [updated] = await db.select().from(devices).where(eq(devices.id, device.id));
		return updated || device;
	}

	return device;
}

export async function updateDevice(
	deviceId: string,
	companyId: string,
	data: { name?: string; serialNumber?: string },
) {
	const [device] = await db
		.update(devices)
		.set({ ...data, updatedAt: new Date() })
		.where(and(eq(devices.id, deviceId), eq(devices.companyId, companyId)))
		.returning();
	return device;
}

export async function deleteDevice(deviceId: string, companyId: string) {
	const [device] = await db
		.select()
		.from(devices)
		.where(and(eq(devices.id, deviceId), eq(devices.companyId, companyId)));

	if (device?.hawkbitTargetId) {
		appLogger.info(`[DEVICES] Removing device ${deviceId}. Triggering hawkBit target deletion...`);
		await DeviceSyncEngine.deleteTarget(device.hawkbitTargetId);
	}

	await db.delete(devices).where(and(eq(devices.id, deviceId), eq(devices.companyId, companyId)));
}

export async function updateDeviceStatus(deviceId: string, status: string) {
	await db
		.update(devices)
		.set({ status: status as any, updatedAt: new Date() })
		.where(eq(devices.id, deviceId));
}

export async function updateDeviceLastSeen(deviceId: string) {
	await db
		.update(devices)
		.set({ lastSeenAt: new Date(), updatedAt: new Date() })
		.where(eq(devices.id, deviceId));
}

// ---------------------------------------------------------------------------
// Device ↔ Category assignments (N:N)
// ---------------------------------------------------------------------------

export async function getDeviceCategories(deviceId: string) {
	return await db
		.select({
			id: categories.id,
			companyId: categories.companyId,
			name: categories.name,
			type: categories.type,
			description: categories.description,
			createdAt: categories.createdAt,
			updatedAt: categories.updatedAt,
			assignedAt: deviceCategoryAssignments.assignedAt,
		})
		.from(deviceCategoryAssignments)
		.innerJoin(categories, eq(deviceCategoryAssignments.categoryId, categories.id))
		.where(eq(deviceCategoryAssignments.deviceId, deviceId));
}

export async function assignCategories(deviceId: string, categoryIds: string[]) {
	await db
		.delete(deviceCategoryAssignments)
		.where(eq(deviceCategoryAssignments.deviceId, deviceId));

	if (categoryIds.length > 0) {
		await db.insert(deviceCategoryAssignments).values(
			categoryIds.map((categoryId) => ({
				deviceId,
				categoryId,
			})),
		);
	}
}

export async function getDeviceIdsByCategories(companyId: string, categoryIds: string[]) {
	const assignments = await db
		.select({ deviceId: deviceCategoryAssignments.deviceId })
		.from(deviceCategoryAssignments)
		.innerJoin(categories, eq(deviceCategoryAssignments.categoryId, categories.id))
		.where(
			and(
				inArray(deviceCategoryAssignments.categoryId, categoryIds),
				eq(categories.companyId, companyId),
			),
		);

	return [...new Set(assignments.map((a) => a.deviceId))];
}

export async function getHawkbitTargetIdsForCompany(companyId: string): Promise<string[]> {
	const companyDevices = await db
		.select({ hawkbitTargetId: devices.hawkbitTargetId })
		.from(devices)
		.where(and(eq(devices.companyId, companyId), eq(devices.status, 'accepted')));

	return companyDevices.map((d) => d.hawkbitTargetId).filter((id): id is string => id !== null);
}

// ---------------------------------------------------------------------------
// hawkBit integration
// ---------------------------------------------------------------------------

export async function getHawkbitTargetInfo(targetId: string): Promise<HawkbitTarget> {
	return hawkbitTargets.get(targetId);
}

export async function getHawkbitConnectionState(targetId: string) {
	try {
		const target = await hawkbitTargets.get(targetId);
		const isConnected = target.pollStatus ? !target.pollStatus.overdue : false;
		return {
			targetId: target.controllerId,
			connected: isConnected,
			lastRequestAt: target.pollStatus?.lastRequestAt ?? null,
			nextExpectedRequestAt: target.pollStatus?.nextExpectedRequestAt ?? null,
			ipAddress: target.ipAddress ?? null,
		};
	} catch (error: any) {
		if (error.status === 404) {
			return {
				targetId,
				connected: false,
				lastRequestAt: null,
				nextExpectedRequestAt: null,
				ipAddress: null,
			};
		}
		throw error;
	}
}

export async function getHawkbitTargetAttributes(targetId: string) {
	return hawkbitTargets.getAttributes(targetId);
}

export async function getHawkbitTargetActions(targetId: string) {
	const actions = await hawkbitTargets.getActions(targetId, { limit: 50, sort: 'id:DESC' });
	return actions.content;
}

export async function cancelHawkbitAction(targetId: string, actionId: number) {
	return hawkbitTargets.cancelAction(targetId, actionId, true);
}

export async function syncDeviceStatusFromHawkbit(targetId: string) {
	try {
		const target = await hawkbitTargets.get(targetId);
		const isConnected = target.pollStatus ? !target.pollStatus.overdue : false;

		return {
			updateStatus: target.updateStatus,
			connectionStatus: isConnected ? 'connected' : 'disconnected',
			lastSeen: target.pollStatus?.lastRequestAt
				? new Date(target.pollStatus.lastRequestAt).toISOString()
				: null,
		};
	} catch {
		return null;
	}
}
