/**
 * Served-artifact download — fetches the binary hawkBit actually SERVES for a
 * release (byte-level ground truth for forensic comparison against the factory
 * build). hawkBit stores ONLY the .tar (factory verbatim or server-packaged);
 * the inner payload (.bin image) is extracted from it on demand.
 * Contract: SKILL.md § Firmware OTA.
 */
import { createHash } from 'node:crypto';
import { hawkbitConfig } from '@common/config/hawkbit';
import { hawkbitSoftwareModules } from '@common/hawkbit/client';
import { getFirmwareReleaseById } from './catalog';
import { FirmwareValidationError } from './errors';
import {
	type CanonicalArtifactType,
	type CanonicalTarInfo,
	CANONICAL_DATA_MEMBERS,
	extractTar,
	InvalidPackageError,
	validateCanonicalTar,
} from './tar-validator';

export interface ServedFirmwareArtifact {
	buffer: Buffer;
	/** Forensic filename: fw-<version>-sm<smId>-<original|image.bin>. */
	filename: string;
	sha256: string;
}

export async function downloadServedArtifact(
	releaseId: string,
	part: 'tar' | 'image' = 'tar',
): Promise<ServedFirmwareArtifact> {
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
	const tar = Buffer.from(
		await hawkbitSoftwareModules.downloadArtifact(release.hawkbitSmId, artifact.id),
	);
	if (part === 'image') {
		const { image } = await extractImageFromTar(tar, release.artifactType);
		const ext = release.artifactType === 'firmware-controller' ? '.fir' : '.bin';
		return {
			buffer: image,
			filename: `fw-${sanitize(release.version)}-sm${release.hawkbitSmId}-image${ext}`,
			sha256: sha256(image),
		};
	}
	const original = artifact.providedFilename ?? release.originalFilename ?? 'artifact.tar';
	return {
		buffer: tar,
		filename: `fw-${sanitize(release.version)}-sm${release.hawkbitSmId}-${sanitize(original)}`,
		sha256: sha256(tar),
	};
}

/**
 * Extract the inner payload (the ".bin" image) from a served canonical tar.
 * Pure helper — unit-testable without hawkBit. The image is the tail of the
 * DATA MEMBER (the archive itself ends with end-blocks/padding — slicing the
 * whole file is wrong). Throws INVALID_PACKAGE when not canonical (itself a
 * forensic signal).
 */
export async function extractImageFromTar(
	tar: Buffer,
	artifactType: string,
): Promise<{ image: Buffer; info: CanonicalTarInfo }> {
	try {
		const type = artifactType as CanonicalArtifactType;
		if (!(type in CANONICAL_DATA_MEMBERS)) {
			throw new Error(`unknown artifact type "${artifactType}"`);
		}
		const info = await validateCanonicalTar(tar, type);
		// entries[1] is the data member — order enforced by validateCanonicalTar.
		const data = (await extractTar(tar))[1]!.data;
		return { image: Buffer.from(data.subarray(data.length - info.imageSize)), info };
	} catch (error) {
		throw new FirmwareValidationError(
			error instanceof InvalidPackageError
				? `stored tar failed canonical validation: ${error.message}`
				: `stored tar could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
			'INVALID_PACKAGE',
		);
	}
}

function sha256(buffer: Buffer): string {
	return createHash('sha256').update(buffer).digest('hex');
}

/** Filename-safe: keep word chars, dots and dashes; clamp length. */
function sanitize(name: string): string {
	return name.replace(/[^\w.-]+/g, '_').slice(0, 96);
}
