/**
 * Device Provisioning — factory pre-registration and company claim.
 *
 * The deviceKey is NEVER stored in our DB and NEVER returned in API responses.
 * It is only passed to hawkBit as the target's securityToken.
 */
import { hawkbitConfig } from '@common/config/hawkbit';
import { db } from '@common/db';
import { devices } from '@common/db/schema';
import { hawkbitTargets } from '@common/hawkbit/client';
import { appLogger } from '@common/logger';
import { normalizeSerial, isValidSerialLength } from '@common/utils/serial-number';
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
	// Normalize serial number: dotted/hex → canonical hex + display
	const normalized = normalizeSerial(data.serialNumber);
	if (!normalized) {
		return { success: false, device: null, error: 'Invalid serial number format. Expected hex string (e.g. 255FFFFFFF123456) or dotted format (e.g. 25.5F.FF.FFF.FFFFF.F)' };
	}
	if (!isValidSerialLength(normalized.hex)) {
		return { success: false, device: null, error: `Serial number must be 4-32 hex chars (2-16 bytes). Got ${normalized.hex.length} chars.` };
	}

	const serialHex = normalized.hex;
	const serialDisplay = normalized.display;
	const displayName = data.name || serialDisplay;

	appLogger.info(`[PROVISION] Normalized serial: "${data.serialNumber}" → hex=${serialHex}, display=${serialDisplay}`);

	// Check if serial number is already registered (by hex format)
	const [existing] = await db.select().from(devices).where(eq(devices.serialNumber, serialHex));
	if (existing) {
		return { success: false, device: existing, error: 'Serial number already registered' };
	}

	// Create hawkBit target with factory deviceKey — controllerId MUST be hex format
	if (hawkbitConfig.enabled) {
		try {
			await hawkbitTargets.create({ controllerId: serialHex, name: displayName, securityToken: data.deviceKey });
			appLogger.info(`[PROVISION] Created hawkBit target: ${serialHex}`);
		} catch (error: any) {
			// Target might already exist in hawkBit (e.g. device already polled)
			appLogger.warn(`[PROVISION] hawkBit target creation for ${serialHex}: ${error?.message ?? error}. Continuing.`);
		}
	}

	// Insert into local DB — unclaimed, no company
	const [device] = await db.insert(devices).values({
		companyId: null, name: displayName, serialNumber: serialHex, serialDisplay: serialDisplay,
		hawkbitTargetId: serialHex, status: 'unclaimed', createdBy: data.userId,
	}).returning();

	if (!device) return { success: false, device: null, error: 'Failed to create device' };
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
	// Normalize serial: hex-based serials get converted, non-hex stored as-is
	const normalized = normalizeSerial(data.serialNumber);
	const serialHex = normalized?.hex || data.serialNumber;
	const serialDisplay = normalized?.display || data.serialNumber;

	// Find existing device by serial number — MUST have been provisioned first
	const [existing] = await db.select().from(devices).where(eq(devices.serialNumber, serialHex));

	if (!existing) {
		return {
			success: false,
			device: null,
			error: `Device with serial "${data.serialNumber}" not found. Provision it first via POST /api/devices/provision`,
		};
	}

	if (existing.companyId && existing.companyId !== data.companyId) {
		return { success: false, device: existing, error: 'Device already claimed by another company' };
	}
	if (existing.companyId === data.companyId) {
		return { success: false, device: existing, error: 'Device already in this company' };
	}

	// Claim the unclaimed device
	const displayName = data.name || existing.name;
	const [claimed] = await db.update(devices).set({
		companyId: data.companyId, name: displayName,
		status: existing.hawkbitTargetId ? 'accepted' : 'pending', updatedAt: new Date(),
	}).where(eq(devices.id, existing.id)).returning();

	appLogger.info(`[CLAIM] Device ${serialHex} (${serialDisplay}) claimed by company ${data.companyId}`);
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

	// Normalize serial for hawkBit controllerId
	const normalized = normalizeSerial(device.serialNumber);
	const controllerId = normalized?.hex || device.serialNumber;

	// Create hawkBit target with the factory deviceKey
	if (hawkbitConfig.enabled) {
		try {
			await hawkbitTargets.create({
				controllerId,
				name: device.name,
				securityToken: deviceKey,
			});
			appLogger.info(
				`[PROVISION] Linked device ${device.id} → hawkBit target ${controllerId}`,
			);
		} catch (error: any) {
			appLogger.error(
				`[PROVISION] hawkBit target creation failed for ${controllerId}: ${error?.message ?? error}`,
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
			hawkbitTargetId: controllerId,
			serialNumber: normalized?.hex || device.serialNumber,
			serialDisplay: normalized?.display || device.serialDisplay,
			status: 'accepted',
			updatedAt: new Date(),
		})
		.where(eq(devices.id, deviceId))
		.returning();

	return { success: true, device: updated };
}
