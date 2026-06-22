/**
 * hawkBit name sync — keeps the target name in hawkBit aligned with the local DB.
 *
 * The local `devices.name` is the canonical name (what the user typed at
 * registration). hawkBit also stores a `name` per target, which is what the
 * deployment target list displays. Without syncing, the deployment list shows
 * the factory/provisioning name forever — this is the "device name does not
 * propagate to hawkBit" bug.
 *
 * All functions here are best-effort: failures are logged but never block the
 * local mutation, because the local DB is the source of truth and a transient
 * hawkBit outage must not break device registration/renaming.
 */
import { hawkbitConfig } from '@common/config/hawkbit';
import { hawkbitTargets } from '@common/hawkbit/client';
import { appLogger } from '@common/logger';

/**
 * Pushes the local device name to the hawkBit target.
 *
 * @param controllerId  hawkBit target controllerId (= serial hex)
 * @param name          the canonical name from the local DB
 * @param operation     label for logging (e.g. 'claim', 'update', 'link')
 */
export async function syncTargetName(
	controllerId: string,
	name: string,
	operation: string,
): Promise<void> {
	if (!hawkbitConfig.enabled) return; // tests / local dev without hawkBit
	if (!controllerId || !name) return;

	try {
		await hawkbitTargets.update(controllerId, { name });
		appLogger.info(
			'[%s] Synced name=%s to hawkBit target %s',
			operation.toUpperCase(),
			name,
			controllerId,
		);
	} catch (error: any) {
		// Non-fatal: local DB is canonical. hawkBit name will be synced on the next
		// successful mutation, or via a future reconciliation job.
		appLogger.warn(
			'[%s] Failed to sync name to hawkBit target %s: %s. Local DB remains canonical.',
			operation.toUpperCase(),
			controllerId,
			error?.message ?? error,
		);
	}
}

/** Convenience wrapper for renames (operation='update'). */
export const syncDeviceNameToHawkbit = (controllerId: string, name: string) =>
	syncTargetName(controllerId, name, 'update');
