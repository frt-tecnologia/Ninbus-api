/**
 * Served-artifact download — fetches the binary hawkBit actually SERVES for a
 * release (byte-level ground truth for forensic comparison against the factory
 * build). Contract: SKILL.md § Firmware OTA.
 */
import { createHash } from 'node:crypto';
import { hawkbitConfig } from '@common/config/hawkbit';
import { hawkbitSoftwareModules } from '@common/hawkbit/client';
import { getFirmwareReleaseById } from './catalog';
import { FirmwareValidationError } from './errors';

export interface ServedFirmwareArtifact {
	buffer: Buffer;
	/** Forensic filename: fw-<version>-sm<smId>-<original>. */
	filename: string;
	sha256: string;
}

export async function downloadServedArtifact(releaseId: string): Promise<ServedFirmwareArtifact> {
	if (!hawkbitConfig.enabled) {
		throw new FirmwareValidationError(
			'Firmware operations require hawkBit to be enabled',
			'HAWKBIT_NOT_ENABLED',
		);
	}
	const release = await getFirmwareReleaseById(releaseId);
	const artifacts = await hawkbitSoftwareModules.listArtifacts(release.hawkbitSmId);
	const artifact = artifacts[0];
	if (!artifact) {
		throw new FirmwareValidationError(
			`Software Module ${release.hawkbitSmId} carries no artifact binary.`,
			'NOT_FOUND',
		);
	}
	const buffer = Buffer.from(
		await hawkbitSoftwareModules.downloadArtifact(release.hawkbitSmId, artifact.id),
	);
	const original = artifact.providedFilename ?? release.originalFilename ?? 'artifact.tar';
	return {
		buffer,
		filename: `fw-${sanitize(release.version)}-sm${release.hawkbitSmId}-${sanitize(original)}`,
		sha256: createHash('sha256').update(buffer).digest('hex'),
	};
}

/** Filename-safe: keep word chars, dots and dashes; clamp length. */
function sanitize(name: string): string {
	return name.replace(/[^\w.-]+/g, '_').slice(0, 96);
}
