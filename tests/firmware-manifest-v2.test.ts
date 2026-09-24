/**
 * NPM manifest v2 (version-piso) contract tests — pure unit, no DB/hawkBit.
 *
 * Parity target: tools/ota_sign.py (Ninbus-v4) — the oracle. Every layout,
 * digest and rejection rule here mirrors what the bootloader enforces:
 *   v2 = magic "NPM\x02" + size + digest(image‖counter‖size‖version‖flags)
 *        + counter@40 + version@44 + flags@48 (bit0 only) + DER@53.
 * Device rule: reject counter ≤ floor OR (version ≤ floor AND !allow_downgrade).
 */
import { describe, expect, it } from 'bun:test';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { p256 } from '@noble/curves/nist.js';
import {
	buildNinbusTar,
	buildSignedManifest,
	type ManifestV2Options,
	packVersionString,
} from '../src/modules/firmware/ota-signer';
import { unpackVersionText, validateCanonicalTar } from '../src/modules/firmware/tar-validator';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const IMAGE = Buffer.alloc(2048, 0x5a);

function v2(version: number, flags = 0): ManifestV2Options {
	return { version, flags, key: privateKey };
}

describe('packVersionString (oracle parse_version parity)', () => {
	it('packs X.Y.Z as major<<24|minor<<16|patch<<8', () => {
		expect(packVersionString('4.0.4')).toBe(0x04000400);
		expect(packVersionString('1.2.3')).toBe(0x01020300);
	});
	it('packs X.Y.Z.B with build byte', () => {
		expect(packVersionString('4.0.4.7')).toBe(0x04000407);
	});
	it('rejects suffixes (-dev, -rc1) — v2 is strict', () => {
		expect(() => packVersionString('4.0.4-dev')).toThrow(/sem sufixos/);
		expect(() => packVersionString('4.0.4-rc1')).toThrow();
	});
	it('rejects components > 255 and wrong arity', () => {
		expect(() => packVersionString('4.0.256')).toThrow();
		expect(() => packVersionString('4.0')).toThrow();
		expect(() => packVersionString('4.0.4.0.1')).toThrow();
		expect(() => packVersionString('')).toThrow();
	});
});

describe('buildSignedManifest v2 layout', () => {
	it('writes magic NPM\\x02, counter@40, version@44, flags@48, siglen@52', () => {
		const m = buildSignedManifest(IMAGE, 5, v2(0x04000400, 0));
		expect(m.length).toBe(128);
		expect(m.subarray(0, 4).toString('latin1')).toBe('NPM\x02');
		expect(m.readUInt32LE(4)).toBe(IMAGE.length);
		expect(m.readUInt32LE(40)).toBe(5);
		expect(m.readUInt32LE(44)).toBe(0x04000400);
		expect(m.readUInt32LE(48)).toBe(0);
		const sigLen = m[52]!;
		expect(sigLen).toBeGreaterThanOrEqual(8);
		expect(sigLen).toBeLessThanOrEqual(72);
		expect(m.subarray(53 + sigLen).every((b) => b === 0xff)).toBe(true);
	});
	it('digest covers version+flags — signature verifies over the EXTENDED digest', () => {
		const m = buildSignedManifest(IMAGE, 5, v2(0x04000400, 0));
		const trailer = Buffer.alloc(16);
		trailer.writeUInt32LE(5, 0);
		trailer.writeUInt32LE(IMAGE.length, 4);
		trailer.writeUInt32LE(0x04000400, 8);
		trailer.writeUInt32LE(0, 12);
		const digest = createHash('sha256').update(IMAGE).update(trailer).digest();
		expect(m.subarray(8, 40).toString('hex')).toBe(digest.toString('hex'));
		// ECDSA over the PREHASHED digest (boot contract) verifies with the
		// key's public half — same parity proof the v1 tests use.
		const jwk = privateKey.export({ format: 'jwk' }) as { d?: string };
		const priv = new Uint8Array(Buffer.from(jwk.d!, 'base64url'));
		const sig = m.subarray(53, 53 + m[52]!);
		expect(
			p256.verify(new Uint8Array(sig), new Uint8Array(digest), p256.getPublicKey(priv, false), {
				prehash: false,
				format: 'der',
			}),
		).toBe(true);
	});
	it('v1 (no version) keeps the legacy layout untouched', () => {
		const m = buildSignedManifest(IMAGE, 5, privateKey);
		expect(m.subarray(0, 4).toString('latin1')).toBe('NPM\x01');
		expect(m[44]).toBeGreaterThanOrEqual(8); // siglen where v2 has version
	});
	it('rejects reserved flag bits (only bit0 exists)', () => {
		expect(() => buildSignedManifest(IMAGE, 5, v2(0x04000400, 0x2))).toThrow(/bit0/);
		expect(() => buildSignedManifest(IMAGE, 5, v2(0x04000400, 0x80000000))).toThrow(/bit0/);
	});
});

describe('validateCanonicalTar v1+v2 acceptance', () => {
	it('round-trips a server-signed v2 tar with version+allow_downgrade', async () => {
		const tarBuf = await buildNinbusTar(IMAGE, 9, v2(0x04000400, 0x1));
		const info = await validateCanonicalTar(tarBuf, 'firmware-ninbus');
		expect(info.manifestFormat).toBe(2);
		expect(info.versionPacked).toBe(0x04000400);
		expect(info.versionText).toBe('4.0.4');
		expect(info.counter).toBe(9);
		expect(info.allowDowngrade).toBe(true);
	});
	it('round-trips a v2 tar without downgrade flag', async () => {
		const tarBuf = await buildNinbusTar(IMAGE, 2, v2(packVersionString('1.2.3'), 0));
		const info = await validateCanonicalTar(tarBuf, 'firmware-ninbus');
		expect(info.versionText).toBe('1.2.3');
		expect(info.allowDowngrade).toBe(false);
	});
	it('still accepts legacy v1 tars (versionText null)', async () => {
		const tarBuf = await buildNinbusTar(IMAGE, 2, privateKey);
		const info = await validateCanonicalTar(tarBuf, 'firmware-ninbus');
		expect(info.manifestFormat).toBe(1);
		expect(info.versionPacked).toBeNull();
		expect(info.versionText).toBeNull();
		expect(info.allowDowngrade).toBeNull();
		expect(info.counter).toBe(2);
	});
	it('detects a tampered version field (digest covers version)', async () => {
		const tarBuf = await buildNinbusTar(IMAGE, 3, v2(0x04000400, 0));
		const evil = Buffer.from(tarBuf);
		// locate data/firmware.npm payload: second member's data starts after
		// its 512 B header; manifest version sits at payload offset 44.
		const payloadStart = 512 + 512 + 512; // artifact.info block + data/firmware.npm header
		evil.writeUInt32LE(0x05000000, payloadStart + 44); // "5.0.0" — floor attack
		await expect(validateCanonicalTar(evil, 'firmware-ninbus')).rejects.toThrow(/digest/);
	});
	it('detects a flipped allow_downgrade bit (digest covers flags)', async () => {
		const tarBuf = await buildNinbusTar(IMAGE, 3, v2(0x04000400, 0));
		const evil = Buffer.from(tarBuf);
		const payloadStart = 512 + 512 + 512;
		evil.writeUInt32LE(0x1, payloadStart + 48);
		await expect(validateCanonicalTar(evil, 'firmware-ninbus')).rejects.toThrow(/digest/);
	});
});

describe('unpackVersionText', () => {
	it('omits a zero build byte', () => {
		expect(unpackVersionText(0x04000400)).toBe('4.0.4');
	});
	it('renders a non-zero build byte', () => {
		expect(unpackVersionText(0x04000409)).toBe('4.0.4.9');
	});
	it('round-trips packVersionString', () => {
		expect(unpackVersionText(packVersionString('10.20.30'))).toBe('10.20.30');
	});
});
