/**
 * Canonical v4 OTA Tar Packager — mirrors tools/ota_pack.py (repo Ninbus-v4).
 *
 * GOLDEN RULE: the device NEVER accepts raw .bin/.hex/.elf or hand-made
 * tars — only the canonical USTAR below (see docs/firmware-release-flow.md
 * §5 and tar-validator.ts). Anything else is rejected by the firmware with
 * closed+failure ("REJEITADO: manifesto sem magic NPM" / "artifact type
 * desconhecido").
 *
 *   <name>.tar                    (USTAR, mtime=0, deterministic)
 *   ├── artifact.info             → 'type "<type>"\\n'   (FIRST member, ASCII)
 *   └── data/firmware.npm         → firmware-ninbus: SIGNED manifest + image
 *     | data/config.frz           → configuration-nfx: raw payload
 *     | data/controller.fir       → firmware-controller: raw payload
 *
 * ⚠️ firmware-ninbus CANNOT be packaged here: data/firmware.npm requires the
 * 128 B NPM manifest signed with ECDSA P-256 by tools/ota_sign.py — the key
 * stays offline with the factory. Upload the ota_pack.py-generated .tar
 * directly; the API validates its structure (tar-validator.ts) and stores it
 * VERBATIM in hawkBit. This packager refuses ninbus payloads on purpose.
 */

import type { Readable } from 'node:stream';
import { appLogger } from '@common/logger';
import tar from 'tar-stream';
import { CANONICAL_DATA_MEMBERS, type CanonicalArtifactType } from '../firmware/tar-validator';

export interface PackagedArtifact {
	/** The .tar file as a Blob */
	blob: Blob;
	/** Filename for the tar archive (based on original filename) */
	filename: string;
	/** Size of the tar archive in bytes */
	size: number;
}

/**
 * Package a raw controller/NFX payload into the canonical v4 .tar.
 *
 * @param file - The raw payload file (.fir / .frz)
 * @param artifactType - firmware-controller | configuration-nfx
 * @throws for firmware-ninbus (server cannot sign — use ota_pack.py output)
 */
export async function packageArtifact(file: File, artifactType: string): Promise<PackagedArtifact> {
	if (!(artifactType in CANONICAL_DATA_MEMBERS)) {
		throw new Error(
			`Unknown artifact type: ${artifactType}. Expected one of: ${Object.keys(CANONICAL_DATA_MEMBERS).join(', ')}`,
		);
	}
	if (artifactType === 'firmware-ninbus') {
		throw new Error(
			'firmware-ninbus NÃO pode ser empacotado pelo servidor: data/firmware.npm exige o manifesto NPM assinado (ECDSA P-256) gerado por tools/ota_sign.py + ota_pack.py (repo Ninbus-v4). Suba o update-app.tar gerado pela ferramenta — a API valida e armazena verbatim.',
		);
	}

	const type = artifactType as CanonicalArtifactType;
	const memberName = CANONICAL_DATA_MEMBERS[type];

	// artifact.info — plain ASCII 'type "<name>"\n', FIRST member (ota_pack.py)
	const infoBytes = Buffer.from(`type "${type}"\n`, 'ascii');
	const fileBuffer = Buffer.from(await file.arrayBuffer());

	const pack = tar.pack();
	pack.entry({ name: 'artifact.info', size: infoBytes.length, mtime: new Date(0) }, infoBytes);
	pack.entry({ name: memberName, size: fileBuffer.length, mtime: new Date(0) }, fileBuffer);
	pack.finalize();

	const tarBuffer = await readableToBuffer(pack);
	const baseName = file.name.replace(/\.[^.]+$/, '');
	const tarFilename = `${baseName}.tar`;

	appLogger.info(
		`[TAR] Packaged ${file.name} (${fileBuffer.length} bytes) → ${tarFilename} (${tarBuffer.length} bytes) [type=${type}, member=${memberName}]`,
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
