import { db } from '@common/db';
import { artifacts } from '@common/db/schema';
import {
	type HawkbitArtifact,
	type HawkbitSoftwareModule,
	NINBUS_ARTIFACT_TYPE_META,
	type NinbusArtifactType,
	getOrCreateSoftwareModuleType,
	hawkbitSoftwareModules,
	resolveArtifactType,
} from '@common/hawkbit/client';
import { HawkbitApiError } from '@common/hawkbit/http';
import { hawkbitConfig } from '@common/config/hawkbit';
import { appLogger } from '@common/logger';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ARTIFACT_ALLOWED_EXTENSIONS, ARTIFACT_MAX_SIZE_BYTES } from './schemas';
import { packageArtifact } from './tar-packager';

// Types

export interface ArtifactUploadResult {
	smId: number;
	artifactId?: number;
	name: string;
	version: string;
	type: string;
	size: number;
	/** Original raw firmware file size (before tar packaging). */
	payloadSize: number;
	ninbusType: NinbusArtifactType | null;
	ninbusMeta: (typeof NINBUS_ARTIFACT_TYPE_META)[NinbusArtifactType] | null;
}

export interface ArtifactBinary {
	id: number;
	filename?: string;
	size?: number;
	hashes?: { sha1?: string; sha256?: string; md5?: string };
}

export interface EnrichedSoftwareModule extends HawkbitSoftwareModule {
	ninbusType: NinbusArtifactType | null;
	ninbusMeta: (typeof NINBUS_ARTIFACT_TYPE_META)[NinbusArtifactType] | null;
	artifacts: ArtifactBinary[];
	size?: number;
}

// Error classes

export class ArtifactValidationError extends Error {
	constructor(
		message: string,
		public readonly code:
			| 'INVALID_EXTENSION'
			| 'FILE_TOO_LARGE'
			| 'EMPTY_FILE'
			| 'MISSING_FILE'
			| 'HAWKBIT_NOT_ENABLED'
			| 'NOT_FOUND',
	) {
		super(message);
		this.name = 'ArtifactValidationError';
	}
}

export class ArtifactNotFoundError extends Error {
	constructor(message = 'Artifact not found') {
		super(message);
		this.name = 'ArtifactNotFoundError';
	}
}

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
async function requireOwnership(companyId: string, hawkbitSmId: number): Promise<void> {
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

/** Enrich SM with Ninbus metadata + artifact binaries (file sizes, hashes). */
export async function enrichSoftwareModule(sm: HawkbitSoftwareModule): Promise<EnrichedSoftwareModule> {
	const artifactType = resolveArtifactType(sm);
	let smArtifacts: HawkbitArtifact[] = [];
	try { smArtifacts = await hawkbitSoftwareModules.listArtifacts(sm.id); } catch { /* OK */ }
	const totalSize = smArtifacts.reduce((s, a) => s + (a.size ?? 0), 0);
	return {
		...sm,
		name: extractDisplayName(sm),
		createdAt: sm.createdAt ? new Date(sm.createdAt).toISOString() as any : undefined,
		lastModifiedAt: sm.lastModifiedAt ? new Date(sm.lastModifiedAt).toISOString() as any : undefined,
		ninbusType: artifactType,
		ninbusMeta: artifactType ? NINBUS_ARTIFACT_TYPE_META[artifactType] : null,
		artifacts: smArtifacts.map((a) => ({ id: a.id, filename: a.providedFilename ?? undefined, size: a.size ?? undefined, hashes: a.hashes ?? undefined })),
		size: totalSize || undefined,
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
export async function uploadArtifact(
	companyId: string,
	userId: string,
	file: File,
	artifactName: string,
	artifactType: NinbusArtifactType,
	version?: string,
	description?: string,
): Promise<ArtifactUploadResult> {
	validateFileExtension(file.name);
	validateFileSize(file.size);
	requireHawkbit();

	appLogger.info('[ARTIFACT] Uploading: %s (%d KB) type=%s', file.name, Math.round(file.size / 1024), artifactType);

	// Package raw file into .tar for the embedded device
	const packaged = await packageArtifact(file, artifactType);

	const smType = await getOrCreateSoftwareModuleType(artifactType);
	const smUuid = randomUUID();
	const smInternalName = `sm-${smUuid}`;
	const smVersion = version ?? '1.0';

	// Store user-visible name + metadata in description
	const smDescription = [
		description ?? `Ninbus OTA: ${artifactType}`,
		`artifactName: ${artifactName}`,
		`originalFile: ${file.name}`,
		`payloadBytes: ${file.size}`,
	].join(' | ');

	const sm = await hawkbitSoftwareModules.create({
		name: smInternalName, version: smVersion, type: smType.typeKey, description: smDescription,
	});

	appLogger.info('[ARTIFACT] Created SM %d (display: %s)', sm.id, artifactName);

	const tarFile = new File([packaged.blob], packaged.filename, { type: 'application/x-tar' });
	const artifact = await hawkbitSoftwareModules.uploadArtifact(sm.id, tarFile);

	appLogger.info(
		`[ARTIFACT] Upload complete: artifact #${artifact.id} size=${artifact.size ?? 'undefined'} filename=${artifact.providedFilename} ` +
		`(expected ~${packaged.size} bytes)`,
	);

	// Write-through: register in local DB (like claimDevice writes companyId)
	await db.insert(artifacts).values({
		companyId,
		hawkbitSmId: sm.id,
		name: artifactName,
		artifactType,
		version: sm.version,
		description: description ?? `Ninbus OTA: ${artifactType}`,
		originalFilename: file.name,
		payloadSize: file.size,
		packageSize: packaged.size,
		createdBy: userId,
	});

	appLogger.info('[ARTIFACT] Registered SM %d for company %s', sm.id, companyId);

	return {
		smId: sm.id, artifactId: artifact.id, name: artifactName,
		version: sm.version, type: sm.type, size: packaged.size, payloadSize: file.size,
		ninbusType: artifactType, ninbusMeta: NINBUS_ARTIFACT_TYPE_META[artifactType],
	};
}

/** List artifacts for a specific company (like getCompanyDevices). */
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
		const enriched = await Promise.all(hawkbitSMs.map(enrichSoftwareModule));
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
	return enrichSoftwareModule(await hawkbitSoftwareModules.get(smId));
}

/** Delete a software module — verify ownership, then delete from hawkBit + local DB. */
export async function deleteArtifact(companyId: string, smId: number): Promise<{ deleted: boolean; message: string }> {
	await requireOwnership(companyId, smId);
	requireHawkbit();

	try {
		await hawkbitSoftwareModules.delete(smId);
	} catch (error) {
		if (error instanceof HawkbitApiError && error.status === 404) {
			// SM already deleted in hawkBit — clean up local record
			await db.delete(artifacts).where(eq(artifacts.hawkbitSmId, smId));
			return { deleted: true, message: 'Artifact already deleted' };
		}
		throw error;
	}

	// Delete local record
	await db.delete(artifacts).where(eq(artifacts.hawkbitSmId, smId));

	// Verify deletion in hawkBit
	try {
		const check = await hawkbitSoftwareModules.get(smId);
		if (!check.deleted) appLogger.warn('[ARTIFACT] SM %d still active after delete', smId);
	} catch { /* 404 = hard-deleted */ }

	return { deleted: true, message: 'Artifact deleted successfully' };
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
