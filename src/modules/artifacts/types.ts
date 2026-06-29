/**
 * Artifact types and error classes.
 * Extracted from service.ts to keep file under 250 lines.
 */
import { type HawkbitSoftwareModule, NINBUS_ARTIFACT_TYPE_META, type NinbusArtifactType } from '@common/hawkbit/client';

export interface ArtifactUploadResult {
	smId: number;
	artifactId?: number;
	name: string;
	version: string;
	type: string;
	size: number;
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
	lockedByDistributionSets: Array<{ id: number; name: string; status: 'active' | 'completed' }>;
	deletable: boolean;
}

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

export class ArtifactLockedError extends Error {
	constructor(
		message: string,
		public readonly blockingDS: Array<{ id: number; name: string; activeTargets: number }>,
	) {
		super(message);
		this.name = 'ArtifactLockedError';
	}
}
