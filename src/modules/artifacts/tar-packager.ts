/**
 * Artifact Tar Packager — Creates .tar archives for Ninbus OTA.
 *
 * The embedded device (Ninbus v3) expects artifacts in a specific .tar format:
 *
 *   header-info/
 *   header-info/featureidentity.json     ← identifies artifact type
 *   data/
 *   data/payload.bin                     ← the actual firmware file (.frz, .fir, .bin)
 *
 * Rules:
 * - MUST be plain .tar (NOT .tar.gz — decompressor is stub on device)
 * - Directory names MUST be exactly "header-info" and "data"
 * - Payload filename MUST be "payload.bin"
 * - featureidentity.json has a single {"type": "..."} field
 *
 * ⚠️ FIRMWARE-NINBUS PAYLOAD REQUIREMENT (critical):
 * For type "firmware-ninbus" the backend serves the uploaded bytes VERBATIM as
 * data/payload.bin — it does NOT run CalcCRC.exe and does NOT validate the CRC.
 * The uploaded .fir MUST already be the post-CalcCRC binary with the bootloader
 * CRC16 written at offset 1047 (validated by the STM32 bootloader as
 * *(U16*)(0x08008000 + 1047)). Uploading a raw pre-CRC .fir / .hex / .axf causes
 * the bootloader to silently reject the image and keep the old firmware.
 * See docs/hawkbit-status-flow-mapping.md "Firmware-Ninbus Self-Update".
 *
 * @see SKILL.md — "DDI Artifact Download" section
 */

import tar from 'tar-stream';
import { Readable } from 'stream';
import { appLogger } from '@common/logger';

// Artifact type → featureidentity.json type value mapping
const TYPE_MAP: Record<string, string> = {
	'firmware-ninbus': 'firmware-ninbus',
	'firmware-controller': 'firmware-controller',
	'configuration-nfx': 'configuration-nfx',
} as const;

export interface PackagedArtifact {
	/** The .tar file as a Blob */
	blob: Blob;
	/** Filename for the tar archive (based on original filename) */
	filename: string;
	/** Size of the tar archive in bytes */
	size: number;
}

/**
 * Package a raw firmware file into the .tar format expected by the Ninbus embedded device.
 *
 * @param file - The raw firmware file (.frz, .fir, .bin, etc.)
 * @param artifactType - The Ninbus artifact type (e.g., 'configuration-nfx')
 * @returns {PackagedArtifact} The packaged .tar archive
 */
export async function packageArtifact(
	file: File,
	artifactType: string,
): Promise<PackagedArtifact> {
	const ninbusType = TYPE_MAP[artifactType];
	if (!ninbusType) {
		throw new Error(`Unknown artifact type: ${artifactType}. Expected one of: ${Object.keys(TYPE_MAP).join(', ')}`);
	}

	const featureIdentity = JSON.stringify({ type: ninbusType });
	const featureIdentityBytes = Buffer.from(featureIdentity, 'utf-8');

	// Read the raw firmware file
	const fileBuffer = Buffer.from(await file.arrayBuffer());

	// Create the tar archive using tar-stream
	const pack = tar.pack();

	// Add header-info/featureidentity.json
	pack.entry(
		{ name: 'header-info/featureidentity.json', size: featureIdentityBytes.length, mode: 0o644 },
		featureIdentityBytes,
	);

	// Add data/payload.bin
	pack.entry(
		{ name: 'data/payload.bin', size: fileBuffer.length, mode: 0o644 },
		fileBuffer,
	);

	pack.finalize();

	// Convert tar-stream Readable to Buffer
	const tarBuffer = await readableToBuffer(pack);

	// Generate tar filename from original
	const baseName = file.name.replace(/\.[^.]+$/, '');
	const tarFilename = `${baseName}.tar`;

	appLogger.info(
		`[TAR] Packaged ${file.name} (${fileBuffer.length} bytes) → ${tarFilename} (${tarBuffer.length} bytes) [type=${ninbusType}]`,
	);

	return {
		blob: new Blob([tarBuffer], { type: 'application/x-tar' }),
		filename: tarFilename,
		size: tarBuffer.length,
	};
}

/** Convert a Node.js Readable stream to a Buffer. */
function readableToBuffer(readable: Readable): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		readable.on('data', (chunk: Buffer) => chunks.push(chunk));
		readable.on('end', () => resolve(Buffer.concat(chunks)));
		readable.on('error', reject);
	});
}

