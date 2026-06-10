import { db } from '@common/db';
import { artifacts } from '@common/db/schema';
import {
	type HawkbitArtifact,
	type HawkbitSoftwareModule,
	NINBUS_ARTIFACT_TYPE_META,
	hawkbitSoftwareModules,
	resolveArtifactType,
} from '@common/hawkbit/client';
import { hawkbitConfig } from '@common/config/hawkbit';
import { appLogger } from '@common/logger';
import { eq } from 'drizzle-orm';
// Re-exports from split files
export { resolveLockStatus, deleteArtifact } from './lock-resolution';
export { uploadArtifact } from './upload';
import { ARTIFACT_ALLOWED_EXTENSIONS, ARTIFACT_MAX_SIZE_BYTES } from './schemas';

// Types

// Types and error classes
export type { ArtifactUploadResult, ArtifactBinary, EnrichedSoftwareModule } from './types';
export { ArtifactValidationError, ArtifactNotFoundError, ArtifactLockedError } from './types';
import type { EnrichedSoftwareModule } from './types';
import { ArtifactValidationError, ArtifactNotFoundError } from './types';

// Guards

function requireHawkbit(): void {
	if (!hawkbitConfig.enabled) {
		throw new ArtifactValidationError('Artifact operations require hawkBit to be enabled', 'HAWKBIT_NOT_ENABLED');
	}
}

/**
 * Verify that a hawkBit Software Module belongs to the given company.
 * Throws ArtifactNotFoundError if not owned by the company.
 */
export async function requireOwnership(companyId: string, hawkbitSmId: number): Promise<void> {
	const [local] = await db
		.select({ companyId: artifacts.companyId })
		.from(artifacts)
		.where(eq(artifacts.hawkbitSmId, hawkbitSmId));

	if (!local || local.companyId !== companyId) {
		throw new ArtifactNotFoundError(`Artifact #${hawkbitSmId} not found in this company`);
	}
}

// Helpers

/** Extract user-visible artifactName from SM description (stored as "artifactName: X"). */
function extractDisplayName(sm: HawkbitSoftwareModule): string {
	const desc = sm.description ?? '';
	const match = desc.match(/artifactName:\s*([^|]+)/);
	return match ? match[1]!.trim() : sm.name;
}

/** Enrich SM with Ninbus metadata + artifact binaries + lock status. */
export async function enrichSoftwareModule(sm: HawkbitSoftwareModule, companyId?: string): Promise<EnrichedSoftwareModule> {
	const artifactType = resolveArtifactType(sm);
	let smArtifacts: HawkbitArtifact[] = [];
	try { smArtifacts = await hawkbitSoftwareModules.listArtifacts(sm.id); } catch { /* OK */ }
	const totalSize = smArtifacts.reduce((s, a) => s + (a.size ?? 0), 0);

	// Only resolve lock status if companyId provided and SM is locked (avoids unnecessary API calls)
	const lockInfo = companyId
		? await resolveLockStatus(companyId, sm.id, sm.locked ?? false)
		: { lockedByDistributionSets: [], deletable: true };

	return {
		...sm,
		name: extractDisplayName(sm),
		createdAt: sm.createdAt ? new Date(sm.createdAt).toISOString() as any : undefined,
		lastModifiedAt: sm.lastModifiedAt ? new Date(sm.lastModifiedAt).toISOString() as any : undefined,
		ninbusType: artifactType,
		ninbusMeta: artifactType ? NINBUS_ARTIFACT_TYPE_META[artifactType] : null,
		artifacts: smArtifacts.map((a) => ({ id: a.id, filename: a.providedFilename ?? undefined, size: a.size ?? undefined, hashes: a.hashes ?? undefined })),
		size: totalSize || undefined,
		lockedByDistributionSets: lockInfo.lockedByDistributionSets,
		deletable: lockInfo.deletable,
	};
}

/** Validate file extension for firmware upload. */
export function validateFileExtension(filename: string): string {
	const lowerName = filename.toLowerCase();
	const ext = ARTIFACT_ALLOWED_EXTENSIONS.find((e: string) => lowerName.endsWith(e));
	if (!ext) {
		throw new ArtifactValidationError(
			`Invalid file extension. Allowed: ${ARTIFACT_ALLOWED_EXTENSIONS.join(', ')}`,
			'INVALID_EXTENSION',
		);
	}
	return ext;
}

/** Validate file size. */
export function validateFileSize(
	size: number,
	maxBytes?: number,
	code?: ArtifactValidationError['code'],
): number {
	const max = maxBytes ?? ARTIFACT_MAX_SIZE_BYTES;
	const errCode = code ?? 'FILE_TOO_LARGE';
	if (size <= 0) throw new ArtifactValidationError('File is empty', 'EMPTY_FILE');
	if (size > max) {
		const maxMB = Math.round(max / (1024 * 1024));
		throw new ArtifactValidationError(`File size exceeds maximum allowed (${maxMB} MB)`, errCode);
	}
	return size;
}

// ---------------------------------------------------------------------------
// CRUD — all scoped by companyId (same pattern as devices/service.ts)
// ---------------------------------------------------------------------------

/**
 * Upload raw firmware file to hawkBit + register in local DB.
 * Write-through: creates SM in hawkBit AND inserts local artifact record.
 */

export async function listArtifacts(companyId: string, _params?: {
	offset?: number;
	limit?: number;
}): Promise<{ data: EnrichedSoftwareModule[]; total: number }> {
	// 1. Get local artifact records for this company
	let localArtifacts: any[];
	try {
		localArtifacts = await db
			.select()
			.from(artifacts)
			.where(eq(artifacts.companyId, companyId));
	} catch (dbError: any) {
		appLogger.error('[ARTIFACTS] DB query failed: %s', dbError?.message ?? 'unknown');
		return { data: [], total: 0 };
	}

	if (!hawkbitConfig.enabled || localArtifacts.length === 0) {
		return { data: [], total: 0 };
	}

	// 2. Fetch SM data from hawkBit by IDs (company-scoped)
	const smIds = localArtifacts.map((a: any) => a.hawkbitSmId);
	try {
		const hawkbitSMs = await hawkbitSoftwareModules.listByIds(smIds);
		// 3. Build lookup by hawkbitSmId for enrichment
		const enriched = await Promise.all(hawkbitSMs.map((sm) => enrichSoftwareModule(sm, companyId)));
		return { data: enriched, total: enriched.length };
	} catch (hbError: any) {
		appLogger.warn('[ARTIFACTS] hawkBit unavailable: %s', hbError?.message ?? 'unknown');
		return { data: [], total: 0 };
	}
}

/** Get single artifact — verify ownership first (like getDeviceById). */
export async function getArtifact(companyId: string, smId: number): Promise<EnrichedSoftwareModule> {
	await requireOwnership(companyId, smId);
	requireHawkbit();
	return enrichSoftwareModule(await hawkbitSoftwareModules.get(smId), companyId);
}

/** Update artifact description — verify ownership first. */
export async function updateArtifact(companyId: string, smId: number, description: string): Promise<void> {
	await requireOwnership(companyId, smId);
	requireHawkbit();

	// Update hawkBit SM description
	await hawkbitSoftwareModules.update(smId, { description });

	// Update local record
	await db
		.update(artifacts)
		.set({ description, updatedAt: new Date() })
		.where(eq(artifacts.hawkbitSmId, smId));
}

/** Get download URL — verify ownership first. */
export async function getArtifactDownloadUrl(
	companyId: string,
	smId: number,
	artifactId: number,
): Promise<{
	smId: number;
	artifactId: number;
	filename?: string;
	size?: number;
	downloadUrl: string;
}> {
	await requireOwnership(companyId, smId);
	requireHawkbit();

	const artifactFile = await hawkbitSoftwareModules.getArtifact(smId, artifactId);
	const baseUrl = hawkbitConfig.baseUrl;
	return {
		smId,
		artifactId: artifactFile.id,
		filename: artifactFile.providedFilename,
		size: artifactFile.size ?? undefined,
		downloadUrl: `${baseUrl}/rest/v1/softwaremodules/${smId}/artifacts/${artifactId}/download`,
	};
}
