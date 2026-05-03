/**
 * Mender Artifact Format v3 Generator — Pure TypeScript.
 *
 * Generates .mender files from raw firmware payloads for Ninbus OTA updates.
 * No external binary dependency (mender-artifact CLI) required.
 *
 * The .mender v3 format is an outer tar containing:
 *   1. `version`         → JSON {"format":"mender","version":3}
 *   2. `manifest`        → SHA-256 checksums of version, header.tar.gz, data/0000/<files>
 *   3. `header.tar.gz`   → gzipped tar with header-info + headers/0000/type-info
 *   4. `data/0000.tar.gz` → gzipped tar with the raw payload file
 *
 * @see mender-server/backend/services/deployments/app/app.go (getMetaFromArchive)
 * @see https://github.com/mendersoftware/mender-artifact (awriter/writer.go)
 */

import type { NinbusArtifactType } from './client';

// ---------------------------------------------------------------------------
// Tar Builder — Minimal tar archive creator (POSIX/UStar format)
// ---------------------------------------------------------------------------

const BLOCK = 512;

function writeOctal(buf: Uint8Array, offset: number, len: number, value: number | string) {
	const s = typeof value === 'number' ? value.toString(8) : value;
	const padded = `${s.padStart(len - 1, '0')}\0`;
	new TextEncoder().encodeInto(padded, buf.subarray(offset, offset + len));
}

function tarHeader(name: string, size: number): Uint8Array {
	const h = new Uint8Array(BLOCK);
	const enc = new TextEncoder();

	enc.encodeInto(name, h.subarray(0, Math.min(name.length + 1, 100)) as Uint8Array<ArrayBuffer>);
	writeOctal(h, 100, 8, '0000644');
	writeOctal(h, 108, 8, '0000000');
	writeOctal(h, 116, 8, '0000000');
	writeOctal(h, 124, 12, size);
	writeOctal(h, 136, 12, Math.floor(Date.now() / 1000));
	enc.encodeInto('        ', h.subarray(148, 156));
	h[156] = 0x30;
	enc.encodeInto('ustar\0', h.subarray(257, 263));
	enc.encodeInto('00', h.subarray(263, 265));

	let checksum = 0;
	for (let i = 0; i < BLOCK; i++) checksum += h[i]!;
	writeOctal(h, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);

	return h;
}

function padToBlock(data: Uint8Array): Uint8Array {
	const rem = data.length % BLOCK;
	if (rem === 0) return data;
	const padded = new Uint8Array(data.length + (BLOCK - rem));
	padded.set(data);
	return padded;
}

function tarEntry(name: string, content: Uint8Array): Uint8Array {
	const header = tarHeader(name, content.length);
	const padded = padToBlock(content);
	const out = new Uint8Array(header.length + padded.length);
	out.set(header);
	out.set(padded, header.length);
	return out;
}

function buildTar(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
	const parts: Uint8Array[] = [];
	for (const f of files) parts.push(tarEntry(f.name, f.data));
	parts.push(new Uint8Array(BLOCK * 2));

	const total = parts.reduce((s, p) => s + p.length, 0);
	const out = new Uint8Array(total);
	let off = 0;
	for (const p of parts) {
		out.set(p, off);
		off += p.length;
	}
	return out;
}

// ---------------------------------------------------------------------------
// SHA-256 helper
// ---------------------------------------------------------------------------

async function sha256Hex(data: Uint8Array): Promise<string> {
	const hash = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
	return Array.from(new Uint8Array(hash))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

// ---------------------------------------------------------------------------
// Mender Artifact Generator
// ---------------------------------------------------------------------------

export interface GenerateMenderArtifactOptions {
	/** Artifact name (e.g., "ninbus-firmware-3.3.0") — must be unique */
	artifactName: string;
	/** Ninbus artifact type — determines what action the device takes */
	artifactType: NinbusArtifactType;
	/** Target device type (default: "ninbus-wifi-v3") */
	deviceType?: string;
	/** Optional description */
	description?: string;
	/** Raw payload filename (e.g., "firmware.fir", "nfx.frz") */
	payloadFileName: string;
	/** Raw payload data */
	payloadData: Uint8Array;
}

/**
 * Generate a Mender artifact v3 from a raw firmware payload.
 *
 * The manifest in v3 contains checksums of:
 * - `version` file
 * - `header.tar.gz` file
 * - `data/0000/<payload_filename>` — individual file checksum (NOT the tar.gz)
 *
 * Artifact type → device action mapping:
 * - firmware-ninbus      → NAND flash → reboot (HIGH risk)
 * - firmware-controller  → CAN bus → LightDot update (MEDIUM risk)
 * - configuration-nfx    → NAND NFX → CAN → LightDot config (LOW risk)
 */
export async function generateMenderArtifact(
	options: GenerateMenderArtifactOptions,
): Promise<Uint8Array> {
	const deviceType = options.deviceType || 'ninbus-wifi-v3';
	const enc = new TextEncoder();

	// 1. Version file — {"format":"mender","version":3}
	const versionData = enc.encode(JSON.stringify({ format: 'mender', version: 3 }));

	// 2. Data tar.gz — contains the raw payload file
	const dataTar = buildTar([{ name: options.payloadFileName, data: options.payloadData }]);
	const dataTarGz = Bun.gzipSync(dataTar as Uint8Array<ArrayBuffer>);

	// 3. Header-info (v3 format: payloads + artifact_provides + artifact_depends)
	const headerInfo = JSON.stringify({
		payloads: [{ type: options.artifactType }],
		artifact_provides: {
			artifact_name: options.artifactName,
		},
		artifact_depends: {
			device_type: [deviceType],
		},
	});

	// 4. Type-info (v3 TypeInfoV3)
	const typeInfo = JSON.stringify({
		type: options.artifactType,
		clears_artifact_provides: ['artifact_name'],
	});

	// 5. Build header tar.gz
	const headerTar = buildTar([
		{ name: 'header-info', data: enc.encode(headerInfo) },
		{ name: 'headers/0000/type-info', data: enc.encode(typeInfo) },
	]);
	const headerTarGz = Bun.gzipSync(headerTar as Uint8Array<ArrayBuffer>);

	// 6. Manifest — checksums: version, header.tar.gz, data/0000/<filename>
	const [versionCk, headerCk, payloadCk] = await Promise.all([
		sha256Hex(versionData),
		sha256Hex(headerTarGz),
		sha256Hex(options.payloadData),
	]);
	const manifest = `${[
		`${versionCk}  version`,
		`${headerCk}  header.tar.gz`,
		`${payloadCk}  data/0000/${options.payloadFileName}`,
	].join('\n')}\n`;

	// 7. Build outer tar — v3 order: version → manifest → header.tar.gz → data/xxxx.tar.gz
	return buildTar([
		{ name: 'version', data: versionData },
		{ name: 'manifest', data: enc.encode(manifest) },
		{ name: 'header.tar.gz', data: headerTarGz },
		{ name: 'data/0000.tar.gz', data: dataTarGz },
	]);
}
