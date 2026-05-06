/**
 * Device Provisioning — Mode B (Device Key) auto-provisioning.
 *
 * Two flows:
 *   1. Admin registers device WITH deviceKey → auto-creates hawkBit target → status "accepted"
 *   2. Operator registers device WITHOUT deviceKey → local DB only → status "pending"
 *      → Admin later links device via PUT /:deviceId/link with deviceKey
 *
 * The deviceKey is the factory security token printed on the device label.
 * It becomes the hawkBit target's securityToken (used by the DDI client).
 * The deviceKey is NEVER stored in our DB and NEVER returned in API responses.
 */
import { hawkbitConfig } from '@common/config/hawkbit';
import { db } from '@common/db';
import { devices } from '@common/db/schema';
import { hawkbitTargets } from '@common/hawkbit/client';
import { appLogger } from '@common/logger';
import { and, eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Register + auto-provision (called from service.registerDevice)
// ---------------------------------------------------------------------------

export async function provisionDevice(data: {
	companyId: string;
	name: string;
	serialNumber: string;
	deviceKey?: string;
	userId: string;
}) {
	// 1. Insert into local DB — status depends on whether deviceKey was provided
	const initialStatus = data.deviceKey ? 'accepted' : 'pending';
	const hawkbitTargetId = data.deviceKey ? data.serialNumber : null;

	const [device] = await db
		.insert(devices)
		.values({
			companyId: data.companyId,
			name: data.name,
			serialNumber: data.serialNumber,
			hawkbitTargetId,
			status: initialStatus,
			createdBy: data.userId,
		})
		.returning();

	if (!device) return device;

	// 2. If deviceKey provided (Mode B) — auto-create hawkBit target
	if (data.deviceKey && hawkbitConfig.enabled) {
		try {
			await hawkbitTargets.create({
				controllerId: data.serialNumber,
				name: data.name,
				securityToken: data.deviceKey,
			});
			appLogger.info(
				`[PROVISION] Created hawkBit target: ${data.serialNumber} (Mode B auto-provisioning)`,
			);
		} catch (error: any) {
			// Target might already exist — log but revert to pending
			appLogger.warn(
				`[PROVISION] hawkBit target creation failed for ${data.serialNumber}: ${error?.message ?? error}`,
			);
			await db
				.update(devices)
				.set({ hawkbitTargetId: null, status: 'pending', updatedAt: new Date() })
				.where(eq(devices.id, device.id));
			const [updated] = await db.select().from(devices).where(eq(devices.id, device.id));
			return updated || device;
		}
	}

	return device;
}

// ---------------------------------------------------------------------------
// Link a pending device (admin provides deviceKey after registration)
// ---------------------------------------------------------------------------

export async function linkDevice(
	deviceId: string,
	companyId: string,
	deviceKey: string,
): Promise<{ success: boolean; device: any; error?: string }> {
	// 1. Load the device
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

	// 2. Create hawkBit target with the factory deviceKey as securityToken
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

	// 3. Update local DB — device is now accepted
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
