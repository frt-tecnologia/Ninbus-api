/**
 * Device Provisioning — factory pre-registration and company claim.
 *
 * Flow:
 *   1. Factory/warehouse admin: POST /api/devices/provision
 *      → Creates hawkBit target (securityToken = deviceKey)
 *      → Inserts device in DB with status "unclaimed", companyId = null
 *      → Device starts polling hawkBit immediately
 *
 *   2. Company member: POST /api/companies/:id/devices
 *      → Finds existing device by serialNumber
 *      → Sets companyId + status "accepted"
 *      → Device becomes visible in company dashboard
 *
 * The deviceKey is NEVER stored in our DB and NEVER returned in API responses.
 * It is only passed to hawkBit as the target's securityToken.
 */
import { hawkbitConfig } from '@common/config/hawkbit';
import { db } from '@common/db';
import { devices } from '@common/db/schema';
import { hawkbitTargets } from '@common/hawkbit/client';
import { appLogger } from '@common/logger';
import { and, eq, isNull } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Factory provisioning — creates hawkBit target + local unclaimed device
// ---------------------------------------------------------------------------

export async function provisionDevice(data: {
	serialNumber: string;
	deviceKey: string;
	name?: string;
	userId: string;
}): Promise<{ success: boolean; device: any; error?: string }> {
	const displayName = data.name || data.serialNumber;

	// 1. Check if serial number is already registered
	const [existing] = await db
		.select()
		.from(devices)
		.where(eq(devices.serialNumber, data.serialNumber));

	if (existing) {
		return { success: false, device: existing, error: 'Serial number already registered' };
	}

	// 2. Create hawkBit target with factory deviceKey
	if (hawkbitConfig.enabled) {
		try {
			await hawkbitTargets.create({
				controllerId: data.serialNumber,
				name: displayName,
				securityToken: data.deviceKey,
			});
			appLogger.info(
				`[PROVISION] Created hawkBit target: ${data.serialNumber}`,
			);
		} catch (error: any) {
			// Target might already exist in hawkBit (e.g. device already polled)
			appLogger.warn(
				`[PROVISION] hawkBit target creation for ${data.serialNumber}: ${error?.message ?? error}. Continuing with local registration.`,
			);
		}
	}

	// 3. Insert into local DB — unclaimed, no company
	const [device] = await db
		.insert(devices)
		.values({
			companyId: null,
			name: displayName,
			serialNumber: data.serialNumber,
			hawkbitTargetId: data.serialNumber,
			status: 'unclaimed',
			createdBy: data.userId,
		})
		.returning();

	if (!device) {
		return { success: false, device: null, error: 'Failed to create device' };
	}

	return { success: true, device };
}

// ---------------------------------------------------------------------------
// List unclaimed devices (no company)
// ---------------------------------------------------------------------------

export async function listUnclaimedDevices() {
	return db
		.select()
		.from(devices)
		.where(and(isNull(devices.companyId), eq(devices.status, 'unclaimed')))
		.orderBy(devices.createdAt);
}

// ---------------------------------------------------------------------------
// Claim device for a company (called from service.registerDevice)
// ---------------------------------------------------------------------------

export async function claimDevice(data: {
	companyId: string;
	serialNumber: string;
	name?: string;
	userId: string;
}): Promise<{ success: boolean; device: any; error?: string }> {
	// 1. Find existing device by serial number
	const [existing] = await db
		.select()
		.from(devices)
		.where(eq(devices.serialNumber, data.serialNumber));

	if (!existing) {
		// Device not provisioned yet — create local entry as pending
		const [device] = await db
			.insert(devices)
			.values({
				companyId: data.companyId,
				name: data.name || data.serialNumber,
				serialNumber: data.serialNumber,
				hawkbitTargetId: null,
				status: 'pending',
				createdBy: data.userId,
			})
			.returning();

		return {
			success: true,
			device,
			error: 'Device not yet provisioned in hawkBit. Registered locally as pending.',
		};
	}

	// 2. Device already belongs to another company
	if (existing.companyId && existing.companyId !== data.companyId) {
		return { success: false, device: existing, error: 'Device already claimed by another company' };
	}

	// 3. Device already in this company
	if (existing.companyId === data.companyId) {
		return { success: false, device: existing, error: 'Device already in this company' };
	}

	// 4. Claim the unclaimed device
	const displayName = data.name || existing.name;
	const [claimed] = await db
		.update(devices)
		.set({
			companyId: data.companyId,
			name: displayName,
			status: existing.hawkbitTargetId ? 'accepted' : 'pending',
			updatedAt: new Date(),
		})
		.where(eq(devices.id, existing.id))
		.returning();

	appLogger.info(
		`[CLAIM] Device ${data.serialNumber} claimed by company ${data.companyId}`,
	);

	return { success: true, device: claimed };
}

// ---------------------------------------------------------------------------
// Link a pending device (legacy — admin provides deviceKey after registration)
// ---------------------------------------------------------------------------

export async function linkDevice(
	deviceId: string,
	companyId: string,
	deviceKey: string,
): Promise<{ success: boolean; device: any; error?: string }> {
	const [device] = await db
		.select()
		.from(devices)
		.where(and(eq(devices.id, deviceId), eq(devices.companyId, companyId)));

	if (!device) {
		return { success: false, device: null, error: 'Device not found' };
	}

	if (device.status === 'accepted' && device.hawkbitTargetId) {
		return { success: false, device, error: 'Device is already linked to hawkBit' };
	}

	if (!device.serialNumber) {
		return {
			success: false,
			device,
			error: 'Device must have a serial number before it can be linked',
		};
	}

	// Create hawkBit target with the factory deviceKey
	if (hawkbitConfig.enabled) {
		try {
			await hawkbitTargets.create({
				controllerId: device.serialNumber,
				name: device.name,
				securityToken: deviceKey,
			});
			appLogger.info(
				`[PROVISION] Linked device ${device.id} → hawkBit target ${device.serialNumber}`,
			);
		} catch (error: any) {
			appLogger.error(
				`[PROVISION] hawkBit target creation failed for ${device.serialNumber}: ${error?.message ?? error}`,
			);
			return {
				success: false,
				device,
				error: `Failed to create hawkBit target: ${error?.message ?? 'Unknown error'}`,
			};
		}
	}

	const [updated] = await db
		.update(devices)
		.set({
			hawkbitTargetId: device.serialNumber,
			status: 'accepted',
			updatedAt: new Date(),
		})
		.where(eq(devices.id, deviceId))
		.returning();

	return { success: true, device: updated };
}
