/**
 * Artifact lock resolution — handle hawkBit 423 Locked errors.
 *
 * hawkBit never auto-unlocks Distribution Sets after deployment completes.
 * Software Modules stay locked forever. This module:
 * 1. Finds DS blocking a SM via local deployments table
 * 2. Classifies each DS as active (deployment running) or completed
 * 3. Auto-cleans completed DS + retries SM deletion
 * 4. Returns 409 only when genuinely active deployments exist
 *
 * Extracted from service.ts to keep file under 250 lines.
 */
import { db } from '@common/db';
import { artifacts, deployments } from '@common/db/schema';
import type { HawkbitDistributionSet } from '@common/hawkbit/client';
import { hawkbitDistributionSets, hawkbitSoftwareModules } from '@common/hawkbit/client';
import { HawkbitApiError } from '@common/hawkbit/http';
import { hawkbitConfig } from '@common/config/hawkbit';
import { appLogger } from '@common/logger';
import { eq } from 'drizzle-orm';
import { forceCloseActiveActionsForDS } from '@modules/deployments/actions';
import { requireOwnership } from './service';
import { ArtifactLockedError } from './types';

/** Find DS from local deployments that contain a given SM. */
async function findBlockingDS(companyId: string, smId: number): Promise<HawkbitDistributionSet[]> {
	const localDS = await db
		.select({ hawkbitDsId: deployments.hawkbitDsId })
		.from(deployments)
		.where(eq(deployments.companyId, companyId));

	if (localDS.length === 0) return [];

	const dsResults = await Promise.all(
		localDS.map((row) =>
			hawkbitDistributionSets.get(row.hawkbitDsId).catch(() => null),
		),
	);

	return dsResults.filter(
		(ds): ds is HawkbitDistributionSet =>
			ds !== null && !ds.deleted && (ds.modules ?? []).some((m) => m.id === smId),
	);
}

/** Classify action statistics: active (still running) vs completed. */
function classifyDSStats(actions: Record<string, number>): { total: number; done: number; isActive: boolean } {
	const total = actions['total'] ?? 0;
	const finished = actions['FINISHED'] ?? 0;
	const error = (actions['ERROR'] ?? 0) + (actions['WARNING'] ?? 0);
	const canceled = (actions['CANCELED'] ?? 0) + (actions['CANCELING'] ?? 0);
	const done = finished + error + canceled;
	return { total, done, isActive: total > 0 && done < total };
}

/** Resolve lock status for a SM — checks DS deployment activity in parallel. */
export async function resolveLockStatus(
	companyId: string,
	smId: number,
	smLocked: boolean,
): Promise<{
	lockedByDistributionSets: Array<{ id: number; name: string; status: 'active' | 'completed' }>;
	deletable: boolean;
}> {
	if (!smLocked) {
		return { lockedByDistributionSets: [], deletable: true };
	}

	try {
		const activeDS = await findBlockingDS(companyId, smId);
		if (activeDS.length === 0) {
			return { lockedByDistributionSets: [], deletable: true };
		}

		const statsResults = await Promise.all(
			activeDS.map(async (ds) => {
				try {
					const stats = await hawkbitDistributionSets.getStatistics(ds.id);
					const { isActive } = classifyDSStats(stats.actions ?? {});
					return { id: ds.id, name: ds.name, status: isActive ? 'active' as const : 'completed' as const };
				} catch {
					return { id: ds.id, name: ds.name, status: 'active' as const };
				}
			}),
		);

		const hasActive = statsResults.some((ds) => ds.status === 'active');
		return { lockedByDistributionSets: statsResults, deletable: !hasActive };
	} catch {
		return { lockedByDistributionSets: [], deletable: false };
	}
}

/**
 * Delete a software module — try-first, resolve-on-423.
 *
 * hawkBit never auto-unlocks DS after deployment completes. So when a SM is locked (423),
 * we check which DS block it, classify them as active/completed, and auto-clean completed ones.
 * Only blocks deletion when there are genuinely active deployments.
 */
export async function deleteArtifact(
	companyId: string,
	smId: number,
): Promise<{ deleted: boolean; message: string; cleanedUp?: Array<{ dsId: number; dsName: string }> }> {
	await requireOwnership(companyId, smId);
	if (!hawkbitConfig.enabled) {
		throw new Error('Artifact operations require hawkBit to be enabled');
	}

	try {
		// Happy path — no DS blocking
		await hawkbitSoftwareModules.delete(smId);
	} catch (error) {
		if (error instanceof HawkbitApiError && error.status === 404) {
			await db.delete(artifacts).where(eq(artifacts.hawkbitSmId, smId));
			return { deleted: true, message: 'Artifact already deleted' };
		}

		if (!(error instanceof HawkbitApiError && error.status === 423)) {
			throw error; // 503 in handler
		}

		// 423 Locked — resolve which DS are blocking and auto-clean completed ones
		appLogger.info('[ARTIFACT] SM #%d locked (423). Resolving blocking DS...', smId);

		const activeDS = await findBlockingDS(companyId, smId);

		if (activeDS.length === 0) {
			appLogger.warn('[ARTIFACT] SM #%d locked but no active DS found. Retrying delete...', smId);
			await hawkbitSoftwareModules.delete(smId);
			await db.delete(artifacts).where(eq(artifacts.hawkbitSmId, smId));
			return { deleted: true, message: 'Artifact deleted successfully' };
		}

		// Fetch statistics in parallel to classify each DS
		const classified = await Promise.all(
			activeDS.map(async (ds) => {
				try {
					const stats = await hawkbitDistributionSets.getStatistics(ds.id);
					const { total, done, isActive } = classifyDSStats(stats.actions ?? {});
					return { ds, isActive, total, done };
				} catch {
					return { ds, isActive: true, total: 0, done: 0 }; // fail-safe
				}
			}),
		);

		const activeBlocking = classified.filter((c) => c.isActive);
		const completedBlocking = classified.filter((c) => !c.isActive);

		// If any DS is genuinely active → 409
		if (activeBlocking.length > 0) {
			throw new ArtifactLockedError(
				`Artefato em uso por ${activeBlocking.length} implantação(ões) ativa(s). Finalize ou cancele o(s) deployment(s) antes de deletar.`,
				activeBlocking.map((c) => ({
					id: c.ds.id,
					name: c.ds.name,
					activeTargets: c.total - c.done,
				})),
			);
		}

		// All completed — auto-clean DS then retry SM delete
		appLogger.info('[ARTIFACT] SM #%d locked by %d completed DS. Auto-cleaning...', smId, completedBlocking.length);

		const cleanedUp: Array<{ dsId: number; dsName: string }> = [];
		for (const { ds } of completedBlocking) {
			try {
				await forceCloseActiveActionsForDS(ds.id);
				await hawkbitDistributionSets.delete(ds.id);
				appLogger.info('[ARTIFACT] Auto-cleaned DS #%d (%s)', ds.id, ds.name);
				cleanedUp.push({ dsId: ds.id, dsName: ds.name });
			} catch (dsErr) {
				appLogger.error('[ARTIFACT] Failed to auto-clean DS #%d: %s', ds.id, dsErr);
				throw new ArtifactLockedError(
					`Falha ao limpar distribution set #${ds.id}. Não foi possível deletar o artefato.`,
					[{ id: ds.id, name: ds.name, activeTargets: 0 }],
				);
			}
		}

		// Preserve local deployment records for history — only delete DS in hawkBit
		appLogger.info('[ARTIFACT] Preserved %d local deployment records for history', cleanedUp.length);

		// Retry SM delete — now unlocked
		await hawkbitSoftwareModules.delete(smId);
		await db.delete(artifacts).where(eq(artifacts.hawkbitSmId, smId));

		const msg = cleanedUp.length > 0
			? `Artefato deletado. ${cleanedUp.length} implantação(ões) concluída(s) desvinculada(s). O histórico de deployment foi preservado.`
			: 'Artifact deleted successfully';

		return { deleted: true, message: msg, cleanedUp: cleanedUp.length > 0 ? cleanedUp : undefined };
	}

	// Happy path succeeded — delete local record
	await db.delete(artifacts).where(eq(artifacts.hawkbitSmId, smId));
	return { deleted: true, message: 'Artifact deleted successfully' };
}
