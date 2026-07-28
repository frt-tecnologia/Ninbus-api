/**
 * Deployment deletion — force-close actions, delete DS, cleanup local records + SSE.
 * Extracted from service.ts to keep file under 250 lines.
 */
import { db } from '@common/db';
import { deployments, devices } from '@common/db/schema';
import { hawkbitDistributionSets } from '@common/hawkbit/client';
import { appLogger } from '@common/logger';
import { eq, inArray } from 'drizzle-orm';
import { forceCloseActiveActionsForDS } from './actions';

/** Verify that a hawkBit Distribution Set belongs to the given company. */
export async function requireDeploymentOwnership(
	companyId: string,
	hawkbitDsId: number,
): Promise<void> {
	const [local] = await db
		.select({ companyId: deployments.companyId })
		.from(deployments)
		.where(eq(deployments.hawkbitDsId, hawkbitDsId));

	if (!local || local.companyId !== companyId) {
		throw new Error(`Deployment #${hawkbitDsId} not found in this company`);
	}
}

/** Delete a deployment — verify ownership, then stop + delete + clean up. */
export async function deleteDeployment(dsId: number, companyId: string): Promise<void> {
	await requireDeploymentOwnership(companyId, dsId);

	appLogger.info('[DEPLOY] Deleting deployment DS #%d...', dsId);

	// Step 1: Collect target IDs before force-closing
	let targetControllerIds: string[] = [];
	try {
		const targets = await hawkbitDistributionSets.getAssignedTargets(dsId, { limit: 500 });
		targetControllerIds = targets.content.map((t) => t.controllerId);
		appLogger.info('[DEPLOY] DS #%d has %d assigned targets', dsId, targetControllerIds.length);
	} catch (e) {
		appLogger.warn('[DEPLOY] Could not list targets for DS #%d: %s', dsId, e);
	}

	// Step 2: Force-close ALL active actions for every target in this DS
	if (targetControllerIds.length > 0) {
		await forceCloseActiveActionsForDS(dsId);
	}

	// Step 3: Delete the DS from hawkBit
	await hawkbitDistributionSets.delete(dsId);
	appLogger.info('[DEPLOY] DS #%d deleted from hawkBit', dsId);

	// Step 4: Delete local record
	await db.delete(deployments).where(eq(deployments.hawkbitDsId, dsId));

	// Step 5: Clear local device status for affected targets
	if (targetControllerIds.length > 0) {
		try {
			await db
				.update(devices)
				.set({ hawkbitUpdateStatus: 'in_sync', updatedAt: new Date() })
				.where(inArray(devices.hawkbitTargetId, targetControllerIds));
			appLogger.info(
				'[DEPLOY] Cleared pending status for %d local devices',
				targetControllerIds.length,
			);

			const { protectTargetStatuses } = await import('@modules/devices/sync-helpers');
			protectTargetStatuses(targetControllerIds, 'in_sync');
		} catch (e) {
			appLogger.warn('[DEPLOY] Could not clear local device status: %s', e);
		}
	}

	// Step 6: Emit SSE events so frontend updates immediately
	if (targetControllerIds.length > 0) {
		try {
			const { sseEmitter, statusCoalescer } = await import('@common/sse');
			sseEmitter.emit(companyId, 'deployment.deleted', {
				deploymentId: dsId,
				timestamp: new Date().toISOString(),
			});
			const localDevices = await db
				.select({ id: devices.id, hawkbitTargetId: devices.hawkbitTargetId })
				.from(devices)
				.where(inArray(devices.hawkbitTargetId, targetControllerIds));
			for (const d of localDevices) {
				statusCoalescer.record(companyId, {
					id: d.id,
					s: 'disconnected',
					u: 'in_sync',
					t: null,
				});
			}
		} catch {
			/* SSE failure is non-critical */
		}
	}

	appLogger.info('[DEPLOY] Deployment DS #%d fully deleted and cleaned up', dsId);
}
