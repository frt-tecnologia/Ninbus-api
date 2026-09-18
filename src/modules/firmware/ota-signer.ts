import { type KeyObject, createHash, createPrivateKey } from 'node:crypto';
/**
 * Server-side OTA signer + canonical packager — faithful port of
 * tools/ota_sign.py + tools/ota_pack.py (repo Ninbus-v4).
 *
 * Lets the dashboard accept a raw .bin + counter and produce the SAME signed
 * canonical .tar the factory tools would, keeping one upload interface:
 *
 *   manifest (128 B):
 *     [0:4]   magic "NPM\x01"
 *     [4:8]   image size (LE32)
 *     [8:40]  SHA-256(image ‖ LE32(counter) ‖ LE32(size))
 *     [40:44] counter (LE32) — anti-downgrade, must exceed the bootloader floor
 *     [44]    DER signature length (8..72)
 *     [45:]   DER ECDSA P-256 signature over SHA-256(digest), then 0xFF padding
 *
 *   tar (USTAR, mtime=0): artifact.info ('type "firmware-ninbus"') +
 *   data/firmware.npm (manifest + image).
 *
 * Cryptographic parity with ota_sign.py:
 *   digest = SHA256(image ‖ counter_le ‖ size_le)
 *   sig    = ECDSA_P-256_sign_RAW(priv, digest)   ← Prehashed: e = digest,
 *           NOT SHA256(digest) — the bootloader's psa_verify_hash consumes
 *           the manifest digest directly. In Node: crypto.sign(null, digest).
 * Self-verified + validated against ota_pack/ota_sign by the Python-tools
 * round-trip (docs/firmware-release-flow.md §5).
 *
 * SECURITY: the private key comes from FIRMWARE_SIGNING_KEY (inline PEM or
 * path). It must be the SAME key whose public half is burned into the
 * bootloader (dev bench: tools/keys/dev-ec256.pem). Leaving it unset keeps
 * the stricter posture (tool-generated .tar only). The signature is always
 * self-verified against the key's public half before shipping.
 */
import { readFileSync } from 'node:fs';
import type { Readable } from 'stream';
import { env } from '@common/config/env';
// Raw-digest ECDSA (Prehashed contract): Bun's BoringSSL rejects
// crypto.sign(null, digest, key) with NO_DEFAULT_DIGEST while Node/OpenSSL
// accepts it — @noble/curves signs the PRE-COMPUTED hash on every runtime
// (deterministic RFC 6979, DER output, zero native deps, audited).
import { p256 } from '@noble/curves/nist.js';
import tar from 'tar-stream';

const MANIFEST_SIZE = 128;
const MAX_IMAGE_SIZE = 0x30000; // 192 KiB
const MANIFEST_MAGIC = Buffer.from('NPM\x01', 'ascii');

/** Signing configuration error — surfaces as 400 (not a crash). */
export class OtaSignerError extends Error {
	constructor(
		message: string,
		public readonly code:
			| 'SIGNING_KEY_NOT_CONFIGURED'
			| 'INVALID_KEY'
			| 'INVALID_IMAGE'
			| 'INVALID_COUNTER'
			| 'INVALID_SIGNATURE' = 'SIGNING_KEY_NOT_CONFIGURED',
	) {
		super(message);
		this.name = 'OtaSignerError';
	}
}

let cachedKey: KeyObject | undefined;

/** Resolve FIRMWARE_SIGNING_KEY: inline PEM (\\n escapes) or a file path. */
function loadSigningKey(override?: KeyObject): KeyObject {
	if (override) return override;
	if (cachedKey) return cachedKey;
	const raw = env.FIRMWARE_SIGNING_KEY;
	if (!raw) {
		throw new OtaSignerError(
			'Assinatura server-side não configurada: defina FIRMWARE_SIGNING_KEY (PEM inline ou caminho do arquivo — pubkey correspondente deve estar no bootloader) ou suba o .tar gerado por ota_sign.py + ota_pack.py.',
			'SIGNING_KEY_NOT_CONFIGURED',
		);
	}
	try {
		const pem = raw.includes('-----BEGIN')
			? raw.replaceAll('\\n', '\n')
			: readFileSync(raw.trim(), 'utf-8');
		const key = createPrivateKey(pem);
		if (key.asymmetricKeyType !== 'ec') {
			throw new Error(`esperada EC P-256, recebida ${key.asymmetricKeyType}`);
		}
		cachedKey = key;
		return key;
	} catch (e) {
		throw new OtaSignerError(
			`FIRMWARE_SIGNING_KEY inválida (deve ser um PEM privado EC P-256/prime256v1 sem senha): ${e instanceof Error ? e.message : e}`,
			'INVALID_KEY',
		);
	}
}

/** Strict DER SEQUENCE{INTEGER,INTEGER} validation — port of ota_sign.py. */
export function validateDerSignature(signature: Buffer): void {
	if (signature.length < 8 || signature.length > 72) {
		throw new OtaSignerError('assinatura DER deve ter 8..72 bytes', 'INVALID_SIGNATURE');
	}
	if (signature[0] !== 0x30 || signature[1]! & 0x80 || signature[1] !== signature.length - 2) {
		throw new OtaSignerError('SEQUENCE DER inválida', 'INVALID_SIGNATURE');
	}
	let offset = validateDerInteger(signature, 2);
	offset = validateDerInteger(signature, offset);
	if (offset !== signature.length) {
		throw new OtaSignerError('dados extras após assinatura DER', 'INVALID_SIGNATURE');
	}
}

function validateDerInteger(data: Buffer, offset: number): number {
	const bad = (msg: string) => new OtaSignerError(msg, 'INVALID_SIGNATURE');
	if (offset + 2 > data.length || data[offset] !== 0x02) throw bad('assinatura DER sem INTEGER');
	const length = data[offset + 1]!;
	const start = offset + 2;
	const end = start + length;
	if (length === 0 || length > 33 || end > data.length)
		throw bad('INTEGER DER com tamanho inválido');
	let value = data.subarray(start, end);
	if (value[0]! & 0x80) throw bad('INTEGER DER negativo');
	if (value[0] === 0) {
		if (length === 1 || !(value[1]! & 0x80))
			throw bad('INTEGER DER com zero inicial desnecessário');
		value = value.subarray(1); // strip valid DER padding BEFORE the P-256 range check
	}
	if (value.length > 32 || !value.some((b: number) => b !== 0)) {
		throw bad('INTEGER DER fora de P-256');
	}
	return end;
}

/** digest = SHA-256(image ‖ LE32(counter) ‖ LE32(size)) — shared with the validator. */
function otaDigest(image: Buffer, counter: number): Buffer {
	const trailer = Buffer.alloc(8);
	trailer.writeUInt32LE(counter, 0);
	trailer.writeUInt32LE(image.length, 4);
	return createHash('sha256').update(image).update(trailer).digest();
}

/** Parse the counter like ota_sign.py parse_counter (decimal or 0x hex). */
export function parseCounter(text: string): number {
	const t = text.trim();
	const n = /^0x[0-9a-f]+$/i.test(t) ? Number.parseInt(t, 16) : Number(t);
	if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) {
		throw new OtaSignerError(
			`counter inválido ("${text}") — inteiro 0..4294967295 (decimal ou 0x hex)`,
			'INVALID_COUNTER',
		);
	}
	return n;
}

/**
 * Build the signed 128 B NPM manifest for (image, counter) — port of
 * ota_sign.py build_manifest + sign_digest, including self-verification.
 */
export function buildSignedManifest(
	image: Buffer,
	counter: number,
	keyOverride?: KeyObject,
): Buffer {
	if (image.length === 0 || image.length > MAX_IMAGE_SIZE) {
		throw new OtaSignerError(
			`imagem deve ter 1..${MAX_IMAGE_SIZE} bytes — recebidos ${image.length}`,
			'INVALID_IMAGE',
		);
	}
	const key = loadSigningKey(keyOverride);
	const digest = otaDigest(image, counter);
	// PREHASHED contract (boot_verify.c psa_verify_hash + ota_sign.py
	// Prehashed(SHA256)): e = digest — the manifest digest IS the message hash.
	// Node: algorithm=null signs the RAW digest (crypto.sign('sha256', digest)
	// would hash it AGAIN — e = SHA256(digest) — and every device would
	// reject; caught by the Python-tools round-trip proof, not by Node-only
	// self-consistent tests). DER-encoded ECDSA output by default.
	const jwk = key.export({ format: 'jwk' }) as { d?: string };
	if (!jwk.d) throw new OtaSignerError('chave PEM sem componente privado (d)', 'INVALID_KEY');
	const privScalar = new Uint8Array(Buffer.from(jwk.d, 'base64url'));
	const signature = Buffer.from(
		p256.sign(new Uint8Array(digest), privScalar, { prehash: false, format: 'der' }),
	);
	if (
		!p256.verify(
			new Uint8Array(signature), // noble v2 arg order: (signature, message, pub)
			new Uint8Array(digest),
			p256.getPublicKey(privScalar, false),
			{ prehash: false, format: 'der' },
		)
	) {
		throw new OtaSignerError('autoverificação da assinatura falhou', 'INVALID_SIGNATURE');
	}
	validateDerSignature(signature);

	const manifest = Buffer.alloc(MANIFEST_SIZE, 0xff);
	MANIFEST_MAGIC.copy(manifest, 0);
	manifest.writeUInt32LE(image.length, 4);
	digest.copy(manifest, 8);
	manifest.writeUInt32LE(counter, 40);
	manifest[44] = signature.length;
	signature.copy(manifest, 45);
	return manifest;
}

/** Pack the canonical v4 tar (artifact.info + data/firmware.npm). */
export async function buildNinbusTar(
	image: Buffer,
	counter: number,
	keyOverride?: KeyObject,
): Promise<Buffer> {
	const payload = Buffer.concat([buildSignedManifest(image, counter, keyOverride), image]);
	const pack = tar.pack();
	const info = Buffer.from('type "firmware-ninbus"\n', 'ascii');
	pack.entry({ name: 'artifact.info', size: info.length, mtime: new Date(0) }, info);
	pack.entry({ name: 'data/firmware.npm', size: payload.length, mtime: new Date(0) }, payload);
	pack.finalize();
	return readableToBuffer(pack);
}

function readableToBuffer(readable: Readable): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		readable.on('data', (chunk: Buffer) => chunks.push(chunk));
		readable.on('end', () => resolve(Buffer.concat(chunks)));
		readable.on('error', reject);
	});
}
