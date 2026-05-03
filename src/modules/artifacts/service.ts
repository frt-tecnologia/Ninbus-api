import { appLogger } from '@common/logger';
import { generateMenderArtifact } from '@common/mender/artifact-generator';
import {
	type MenderArtifact,
	NINBUS_ARTIFACT_TYPE_META,
	type NinbusArtifactType,
	menderArtifacts,
	resolveArtifactType,
} from '@common/mender/client';
import { ARTIFACT_ALLOWED_EXTENSIONS, ARTIFACT_MAX_SIZE_BYTES } from './schemas';

// Types

export interface ArtifactUploadResult {
	id: string;
	name: string;
	description?: string;
	size: number;
	ninbusType: NinbusArtifactType | null;
	ninbusMeta: (typeof NINBUS_ARTIFACT_TYPE_META)[NinbusArtifactType] | null;
}

export interface EnrichedArtifact extends MenderArtifact {
	ninbusType: NinbusArtifactType | null;
	ninbusMeta: (typeof NINBUS_ARTIFACT_TYPE_META)[NinbusArtifactType] | null;
}

// Helpers

/** Enrich a Mender artifact with Ninbus type metadata. */
export function enrichArtifact(artifact: MenderArtifact): EnrichedArtifact {
	const artifactType = resolveArtifactType(artifact);
	return {
		...artifact,
		ninbusType: artifactType,
		ninbusMeta: artifactType ? NINBUS_ARTIFACT_TYPE_META[artifactType] : null,
	};
}

/** Validate file extension for Mender artifact upload. */
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

/** Validate file size for Mender artifact upload. */
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
		public readonly code: 'INVALID_EXTENSION' | 'FILE_TOO_LARGE' | 'EMPTY_FILE' | 'MISSING_FILE',
	) {
		super(message);
		this.name = 'ArtifactValidationError';
	}
}

// Service functions

/** Upload pre-built .mender artifact to Mender Gateway. */
export async function uploadArtifact(
	file: File,
	description?: string,
): Promise<ArtifactUploadResult> {
	validateFileExtension(file.name);
	validateFileSize(file.size);
	appLogger.info(`[ARTIFACT] Uploading: ${file.name} (${Math.round(file.size / 1024)} KB)`);

	const formData = new FormData();
	formData.append('artifact', file);
	if (description?.trim().length) formData.append('description', description.trim());

	await menderArtifacts.upload(formData);
	appLogger.info(`[ARTIFACT] Upload complete: ${file.name}`);

	const artifacts = await menderArtifacts.list({ name: file.name });
	const uploaded = artifacts.find((a) => a.name === file.name);
	if (!uploaded) {
		appLogger.warn(`[ARTIFACT] Artifact uploaded but not yet indexed: ${file.name}`);
		return {
			id: '',
			name: file.name,
			description,
			size: file.size,
			ninbusType: null,
			ninbusMeta: null,
		};
	}
	const enriched = enrichArtifact(uploaded);
	return {
		id: enriched.id,
		name: enriched.name,
		description: enriched.description,
		size: enriched.size,
		ninbusType: enriched.ninbusType,
		ninbusMeta: enriched.ninbusMeta,
	};
}

/** List artifacts with Ninbus enrichment. */
export async function listArtifacts(params?: {
	page?: number;
	perPage?: number;
	name?: string;
}): Promise<{ data: EnrichedArtifact[]; total: number }> {
	const artifacts = await menderArtifacts.list(params);
	const enriched = artifacts.map(enrichArtifact);
	return { data: enriched, total: enriched.length };
}

/** Get single artifact with enrichment. */
export async function getArtifact(artifactId: string): Promise<EnrichedArtifact> {
	return enrichArtifact(await menderArtifacts.get(artifactId));
}

/** Get a pre-signed download link. */
export async function getArtifactDownloadLink(
	artifactId: string,
): Promise<{ uri: string; expire: string }> {
	return menderArtifacts.getDownloadLink(artifactId);
}

/** Delete an artifact. */
export async function deleteArtifact(artifactId: string): Promise<void> {
	return menderArtifacts.delete(artifactId);
}

/** Update artifact description. */
export async function updateArtifact(artifactId: string, description: string): Promise<void> {
	return menderArtifacts.update(artifactId, { description });
}

/** Raw payload extensions allowed for artifact generation. */
const GENERATE_ALLOWED_EXTENSIONS = [
	'.fir',
	'.frz',
	'.nfx',
	'.bin',
	'.hex',
	'.fw',
	'.cfg',
	'.conf',
];

/** Maximum raw payload size for generation (100 MB — before .mender wrapping). */
const GENERATE_MAX_SIZE = 100 * 1024 * 1024;

/**
 * Generate a .mender artifact from a raw firmware file and upload to Mender.
 *
 * Creates a Mender Artifact v3 with the specified type embedded in the header,
 * so the embedded device can identify and take the correct action.
 *
 * Flow: raw file → generate .mender in memory → upload to Mender → return enriched data
 */
export async function generateAndUploadArtifact(
	rawFile: File,
	artifactName: string,
	artifactType: NinbusArtifactType,
	description?: string,
): Promise<ArtifactUploadResult> {
	// Validate raw file
	validateGenerateExtension(rawFile.name);
	validateFileSize(rawFile.size || 0, GENERATE_MAX_SIZE, 'GENERATE_FILE_TOO_LARGE');

	appLogger.info(
		`[ARTIFACT-GEN] Generating .mender: name=${artifactName}, type=${artifactType}, file=${rawFile.name} (${Math.round(rawFile.size / 1024)} KB)`,
	);

	// Read raw payload
	const payloadBuffer = await rawFile.arrayBuffer();
	const payloadData = new Uint8Array(payloadBuffer);

	// Generate .mender artifact in memory
	const menderArtifactData = await generateMenderArtifact({
		artifactName,
		artifactType,
		payloadFileName: rawFile.name,
		payloadData,
	});

	appLogger.info(`[ARTIFACT-GEN] Generated .mender: ${menderArtifactData.length} bytes`);

	// Create File from generated .mender data
	const menderFile = new File([menderArtifactData], `${artifactName}.mender`, {
		type: 'application/octet-stream',
	});

	// Upload to Mender using existing upload flow
	const formData = new FormData();
	formData.append('artifact', menderFile);
	if (description && description.trim().length > 0)
		formData.append('description', description.trim());

	await menderArtifacts.upload(formData);
	appLogger.info(`[ARTIFACT-GEN] Upload complete: ${artifactName}`);

	// Retrieve enriched data from Mender
	const artifacts = await menderArtifacts.list({ name: artifactName });
	const uploaded = artifacts.find((a) => a.name === artifactName);
	if (!uploaded) {
		appLogger.warn(`[ARTIFACT-GEN] Artifact uploaded but not yet indexed: ${artifactName}`);
		return {
			id: '',
			name: artifactName,
			description,
			size: rawFile.size,
			ninbusType: artifactType,
			ninbusMeta: NINBUS_ARTIFACT_TYPE_META[artifactType],
		};
	}
	const enriched = enrichArtifact(uploaded);
	return {
		id: enriched.id,
		name: enriched.name,
		description: enriched.description,
		size: enriched.size,
		ninbusType: enriched.ninbusType,
		ninbusMeta: enriched.ninbusMeta,
	};
}

/** Validate raw file extension for artifact generation. */
function validateGenerateExtension(filename: string): string {
	const lowerName = filename.toLowerCase();
	const ext = GENERATE_ALLOWED_EXTENSIONS.find((e) => lowerName.endsWith(e));
	if (!ext) {
		throw new ArtifactValidationError(
			`Invalid raw file extension for generation. Allowed: ${GENERATE_ALLOWED_EXTENSIONS.join(', ')}`,
			'INVALID_EXTENSION',
		);
	}
	return ext;
}
