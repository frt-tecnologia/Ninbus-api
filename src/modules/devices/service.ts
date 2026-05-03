import { db } from '@common/db';
import { categories, deviceCategoryAssignments, devices } from '@common/db/schema';
import { appLogger } from '@common/logger';
import {
	type MenderDevice,
	menderDeviceAuth,
	menderDeviceConnect,
	menderInventory,
} from '@common/mender/client';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DeviceSyncEngine } from './sync';

// ---------------------------------------------------------------------------
// Device CRUD (local DB)
// ---------------------------------------------------------------------------

export async function getCompanyDevices(companyId: string) {
	// Centralized sync
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

	// If device is still pending, try sync
	if (device?.status === 'pending') {
		await DeviceSyncEngine.syncCompany(companyId);
		// Fetch again
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
	menderDeviceId?: string;
	userId: string;
}) {
	const [device] = await db
		.insert(devices)
		.values({
			companyId: data.companyId,
			name: data.name,
			serialNumber: data.serialNumber,
			menderDeviceId: data.menderDeviceId,
			status: data.menderDeviceId ? 'accepted' : 'pending',
			createdBy: data.userId,
		})
		.returning();

	// Trigger sync
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

	if (device?.menderDeviceId) {
		appLogger.info(`[DEVICES] Removing device ${deviceId}. Triggering Mender decommission...`);
		await DeviceSyncEngine.decommissionDevice(device.menderDeviceId);
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
	// Remove existing assignments
	await db
		.delete(deviceCategoryAssignments)
		.where(eq(deviceCategoryAssignments.deviceId, deviceId));

	// Add new assignments
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

export async function getMenderDeviceIdsForCompany(companyId: string): Promise<string[]> {
	const companyDevices = await db
		.select({ menderDeviceId: devices.menderDeviceId })
		.from(devices)
		.where(and(eq(devices.companyId, companyId), eq(devices.status, 'accepted')));

	return companyDevices.map((d) => d.menderDeviceId).filter((id): id is string => id !== null);
}

// ---------------------------------------------------------------------------
// Mender Gateway integration
// ---------------------------------------------------------------------------

export async function getMenderDeviceInfo(menderDeviceId: string): Promise<MenderDevice> {
	return menderDeviceAuth.getDevice(menderDeviceId);
}

export async function approveDevice(deviceId: string, menderDeviceId: string, authId: string) {
	return await DeviceSyncEngine.acceptDevice(deviceId, menderDeviceId, authId);
}

export async function rejectDevice(deviceId: string, menderDeviceId: string, authId: string) {
	return await DeviceSyncEngine.rejectDevice(deviceId, menderDeviceId, authId);
}

export async function getMenderConnectionState(menderDeviceId: string) {
	try {
		return await menderDeviceConnect.getConnectionState(menderDeviceId);
	} catch (error: any) {
		// If Mender returns 404, the device simply hasn't connected to the 'deviceconnect' service yet.
		if (error.status === 404) {
			return {
				device_id: menderDeviceId,
				status: 'disconnected',
				updated_ts: null,
			};
		}
		throw error;
	}
}

export async function forceDeviceCheckUpdate(menderDeviceId: string) {
	return menderDeviceConnect.forceCheckUpdate(menderDeviceId);
}

export async function decommissionDevice(deviceId: string, menderDeviceId: string) {
	await DeviceSyncEngine.decommissionDevice(menderDeviceId);
	await updateDeviceStatus(deviceId, 'decommissioned');
}

export async function getMenderInventory(menderDeviceId: string) {
	return menderInventory.getDevice(menderDeviceId);
}

export async function syncDeviceStatusFromMender(menderDeviceId: string) {
	try {
		const menderDevice = await menderDeviceAuth.getDevice(menderDeviceId);
		const state = await menderDeviceConnect.getConnectionState(menderDeviceId);

		return {
			menderStatus: menderDevice.status,
			connectionStatus: state.status,
			lastSeen: state.updated_ts,
		};
	} catch {
		return null;
	}
}
