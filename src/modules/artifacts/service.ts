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
	let artifacts: HawkbitArtifact[] = [];
	try { artifacts = await hawkbitSoftwareModules.listArtifacts(sm.id); } catch { /* OK */ }
	const totalSize = artifacts.reduce((s, a) => s + (a.size ?? 0), 0);
	return {
		...sm,
		name: extractDisplayName(sm),
		createdAt: sm.createdAt ? new Date(sm.createdAt).toISOString() as any : undefined,
		lastModifiedAt: sm.lastModifiedAt ? new Date(sm.lastModifiedAt).toISOString() as any : undefined,
		ninbusType: artifactType,
		ninbusMeta: artifactType ? NINBUS_ARTIFACT_TYPE_META[artifactType] : null,
		artifacts: artifacts.map((a) => ({ id: a.id, filename: a.providedFilename ?? undefined, size: a.size ?? undefined, hashes: a.hashes ?? undefined })),
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

// Error

export class ArtifactValidationError extends Error {
	constructor(
		message: string,
		public readonly code:
			| 'INVALID_EXTENSION'
			| 'FILE_TOO_LARGE'
			| 'EMPTY_FILE'
			| 'MISSING_FILE'
			| 'HAWKBIT_NOT_ENABLED',
	) {
		super(message);
		this.name = 'ArtifactValidationError';
	}
}

// Guards

function requireHawkbit(): void {
	if (!hawkbitConfig.enabled) {
		throw new ArtifactValidationError('Artifact operations require hawkBit to be enabled', 'HAWKBIT_NOT_ENABLED');
	}
}

/**
 * Upload raw firmware file to hawkBit.
 * SM name is UUID-based (sm-{uuid}) to avoid hawkBit UNIQUE(name,version,type) constraints.
 * hawkBit soft-delete keeps rows with UNIQUE constraint — UUID names prevent all conflicts.
 */
export async function uploadArtifact(
	file: File,
	artifactName: string,
	artifactType: NinbusArtifactType,
	version?: string,
	description?: string,
): Promise<ArtifactUploadResult> {
	validateFileExtension(file.name);
	validateFileSize(file.size);
	requireHawkbit();

	appLogger.info(`[ARTIFACT] Uploading: ${file.name} (${Math.round(file.size / 1024)} KB) type=${artifactType}`);

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

	appLogger.info(`[ARTIFACT] Created SM ${sm.id} (display: ${artifactName})`);

	const tarFile = new File([packaged.blob], packaged.filename, { type: 'application/x-tar' });
	const artifact = await hawkbitSoftwareModules.uploadArtifact(sm.id, tarFile);

	return {
		smId: sm.id, artifactId: artifact.id, name: artifactName,
		version: sm.version, type: sm.type, size: packaged.size, payloadSize: file.size,
		ninbusType: artifactType, ninbusMeta: NINBUS_ARTIFACT_TYPE_META[artifactType],
	};
}

/** List software modules with Ninbus enrichment. */
export async function listArtifacts(params?: {
	offset?: number;
	limit?: number;
}): Promise<{ data: EnrichedSoftwareModule[]; total: number }> {
	if (!hawkbitConfig.enabled) {
		return { data: [], total: 0 };
	}
	const result = await hawkbitSoftwareModules.list(params);
	const enriched = await Promise.all(result.content.map(enrichSoftwareModule));
	return { data: enriched, total: result.total };
}

/** Get single software module with enrichment. */
export async function getArtifact(smId: number): Promise<EnrichedSoftwareModule> {
	requireHawkbit();
	return enrichSoftwareModule(await hawkbitSoftwareModules.get(smId));
}

/** Delete a software module. Verifies deletion in hawkBit. */
export async function deleteArtifact(smId: number): Promise<{ deleted: boolean; message: string }> {
	requireHawkbit();
	try {
		await hawkbitSoftwareModules.delete(smId);
	} catch (error) {
		if (error instanceof HawkbitApiError && error.status === 404) {
			return { deleted: true, message: 'Artifact already deleted' };
		}
		throw error;
	}
	// Verify deletion (hawkBit soft-deletes, get() may still return SM with deleted=true)
	try {
		const check = await hawkbitSoftwareModules.get(smId);
		if (!check.deleted) appLogger.warn(`[ARTIFACT] SM ${smId} still active after delete`);
	} catch { /* 404 = hard-deleted, even better */ }
	return { deleted: true, message: 'Artifact deleted successfully' };
}

/** Update artifact description. */
export async function updateArtifact(smId: number, description: string): Promise<void> {
	requireHawkbit();
	return hawkbitSoftwareModules.update(smId, { description });
}

/** Get download URL for an artifact. */
export async function getArtifactDownloadUrl(
	smId: number,
	artifactId: number,
): Promise<{
	smId: number;
	artifactId: number;
	filename?: string;
	size?: number;
	downloadUrl: string;
}> {
	requireHawkbit();
	const artifact = await hawkbitSoftwareModules.getArtifact(smId, artifactId);
	const baseUrl = hawkbitConfig.baseUrl;
	return {
		smId,
		artifactId: artifact.id,
		filename: artifact.providedFilename,
		size: artifact.size ?? undefined,
		downloadUrl: `${baseUrl}/rest/v1/softwaremodules/${smId}/artifacts/${artifactId}/download`,
	};
}
