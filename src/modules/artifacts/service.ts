import {
	type HawkbitSoftwareModule,
	NINBUS_ARTIFACT_TYPE_META,
	type NinbusArtifactType,
	getOrCreateSoftwareModuleType,
	hawkbitSoftwareModules,
	resolveArtifactType,
} from '@common/hawkbit/client';
import { hawkbitConfig } from '@common/config/hawkbit';
import { appLogger } from '@common/logger';
import { ARTIFACT_ALLOWED_EXTENSIONS, ARTIFACT_MAX_SIZE_BYTES } from './schemas';

// Types

export interface ArtifactUploadResult {
	smId: number;
	artifactId?: number;
	name: string;
	version: string;
	type: string;
	size: number;
	ninbusType: NinbusArtifactType | null;
	ninbusMeta: (typeof NINBUS_ARTIFACT_TYPE_META)[NinbusArtifactType] | null;
}

export interface EnrichedSoftwareModule extends HawkbitSoftwareModule {
	ninbusType: NinbusArtifactType | null;
	ninbusMeta: (typeof NINBUS_ARTIFACT_TYPE_META)[NinbusArtifactType] | null;
}

// Helpers

/** Enrich a hawkBit Software Module with Ninbus type metadata. */
export function enrichSoftwareModule(sm: HawkbitSoftwareModule): EnrichedSoftwareModule {
	const artifactType = resolveArtifactType(sm);
	return {
		...sm,
		ninbusType: artifactType,
		ninbusMeta: artifactType ? NINBUS_ARTIFACT_TYPE_META[artifactType] : null,
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

// Service functions

/**
 * Upload raw firmware file to hawkBit.
 * Creates: Software Module → uploads Artifact binary.
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

	if (!hawkbitConfig.enabled) {
		throw new ArtifactValidationError(
			'Artifact uploads require hawkBit to be enabled',
			'HAWKBIT_NOT_ENABLED',
		);
	}

	appLogger.info(`[ARTIFACT] Uploading: ${file.name} (${Math.round(file.size / 1024)} KB)`);

	// 1. Ensure the Software Module Type exists
	const smType = await getOrCreateSoftwareModuleType(artifactType);

	// 2. Create the Software Module
	const sm = await hawkbitSoftwareModules.create({
		name: artifactName,
		version: version ?? '1.0',
		type: smType.typeKey,
		description: description ?? `Ninbus OTA: ${artifactType}`,
	});

	appLogger.info(`[ARTIFACT] Created Software Module: ${sm.id} (${sm.name})`);

	// 3. Upload the binary as an Artifact
	const artifact = await hawkbitSoftwareModules.uploadArtifact(sm.id, file);

	appLogger.info(`[ARTIFACT] Uploaded artifact: ${artifact.id} (${artifact.providedFilename})`);

	return {
		smId: sm.id,
		artifactId: artifact.id,
		name: sm.name,
		version: sm.version,
		type: sm.type,
		size: file.size,
		ninbusType: artifactType,
		ninbusMeta: NINBUS_ARTIFACT_TYPE_META[artifactType],
	};
}

/** List software modules with Ninbus enrichment. */
export async function listArtifacts(params?: {
	offset?: number;
	limit?: number;
}): Promise<{ data: EnrichedSoftwareModule[]; total: number }> {
	const result = await hawkbitSoftwareModules.list(params);
	const enriched = result.content.map(enrichSoftwareModule);
	return { data: enriched, total: result.total };
}

/** Get single software module with enrichment. */
export async function getArtifact(smId: number): Promise<EnrichedSoftwareModule> {
	return enrichSoftwareModule(await hawkbitSoftwareModules.get(smId));
}

/** Delete a software module. */
export async function deleteArtifact(smId: number): Promise<void> {
	return hawkbitSoftwareModules.delete(smId);
}

/** Update artifact description. */
export async function updateArtifact(smId: number, description: string): Promise<void> {
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
	const artifact = await hawkbitSoftwareModules.getArtifact(smId, artifactId);
	const baseUrl = process.env['HAWKBIT_URL'] ?? 'http://localhost:8080';
	return {
		smId,
		artifactId: artifact.id,
		filename: artifact.providedFilename,
		size: artifact.size ?? undefined,
		downloadUrl: `${baseUrl}/rest/v1/softwaremodules/${smId}/artifacts/${artifactId}/download`,
	};
}
