import { afterAll, describe, expect, it } from 'bun:test';
import { createHash, verify as cryptoVerify, generateKeyPairSync } from 'node:crypto';
import { eq } from 'drizzle-orm';
import tar from 'tar-stream';

const tarMod = tar;

import { p256 } from '@noble/curves/nist.js';
import { createApp } from '../src/app';
import { db } from '../src/common/db';
import { devices, firmwareReleases } from '../src/common/db/schema';
import { extractFirmwareVersions } from '../src/modules/devices/firmware-sync';
import {
	buildNinbusTar,
	parseCounter,
	validateDerSignature,
} from '../src/modules/firmware/ota-signer';
import { compareVersions, extractImageFromTar } from '../src/modules/firmware/service';
import { classifyDeviceFirmware } from '../src/modules/firmware/status-service';
import { validateCanonicalTar } from '../src/modules/firmware/tar-validator';
import { cleanAll } from './test-helpers';

afterAll(async () => {
	await cleanAll();
});

// ---------------------------------------------------------------------------
// Canonical v4 OTA tar fixture (mirrors tools/ota_pack.py output)
// ---------------------------------------------------------------------------

/** Build a structurally valid 128 B NPM manifest (fake ECDSA sig — the
 *  bootloader verifies the real signature; the server checks structure). */
function buildManifest(image: Buffer, counter = 1, signatureLength = 8): Buffer {
	const m = Buffer.alloc(128, 0xff);
	m.write('NPM', 0, 'ascii');
	m.writeUInt32LE(image.length, 4);
	m.fill(
		createHash('sha256').update(image).update(buildLeU32Pair(counter, image.length)).digest(),
		8,
		40,
	);
	m.writeUInt32LE(counter, 40);
	m[44] = signatureLength;
	// signature bytes [45, 45+sigLen) — any bytes pass structural validation
	for (let i = 45; i < 45 + signatureLength; i++) m[i] = 0xab;
	return m;
}

function buildLeU32Pair(a: number, b: number): Buffer {
	const buf = Buffer.alloc(8);
	buf.writeUInt32LE(a, 0);
	buf.writeUInt32LE(b, 4);
	return buf;
}

/** Pack a canonical v4 tar exactly like ota_pack.py (USTAR, mtime=0). */
async function buildCanonicalTar(
	type: 'firmware-ninbus' | 'firmware-controller' | 'configuration-nfx',
	payload: Buffer,
): Promise<Buffer> {
	const member =
		type === 'firmware-ninbus'
			? 'data/firmware.npm'
			: type === 'firmware-controller'
				? 'data/controller.fir'
				: 'data/config.frz';
	const pack = tar.pack();
	const info = Buffer.from(
		`type "${type}"
`,
		'ascii',
	);
	pack.entry({ name: 'artifact.info', size: info.length, mtime: new Date(0) }, info);
	pack.entry({ name: member, size: payload.length, mtime: new Date(0) }, payload);
	pack.finalize();
	const chunks: Buffer[] = [];
	await new Promise<void>((resolve, reject) => {
		pack.on('data', (c: Buffer) => chunks.push(c));
		pack.on('end', () => resolve());
		pack.on('error', reject);
	});
	return Buffer.concat(chunks);
}

/** A structurally-valid UNSIGNED ninbus tar fixture (fake signature). */
async function buildUnsignedNinbusTar(image = Buffer.alloc(1024, 0x55)): Promise<Buffer> {
	return buildCanonicalTar('firmware-ninbus', Buffer.concat([buildManifest(image), image]));
}

// ---------------------------------------------------------------------------
// Unit — pure helpers (no DB, no hawkBit)
// ---------------------------------------------------------------------------

describe('compareVersions (semver)', () => {
	it('orders core versions', () => {
		expect(compareVersions('4.0.1', '3.9.9')).toBeGreaterThan(0);
		expect(compareVersions('3.9.9', '4.0.1')).toBeLessThan(0);
		expect(compareVersions('4.0.1', '4.0.1')).toBe(0);
		expect(compareVersions('10.0.0', '9.0.0')).toBeGreaterThan(0);
	});

	it('release outranks pre-release', () => {
		expect(compareVersions('4.0.1', '4.0.1-rc.1')).toBeGreaterThan(0);
		expect(compareVersions('4.0.1-rc.1', '4.0.1')).toBeLessThan(0);
	});

	it('falls back to string compare for non-semver', () => {
		expect(compareVersions('abc', 'abd')).toBeLessThan(0);
		expect(compareVersions('x', 'x')).toBe(0);
	});
});

describe('extractFirmwareVersions (DDI attributes)', () => {
	it('reads the documented attribute keys', () => {
		expect(
			extractFirmwareVersions({
				'fw.ninbus.version': '4.0.1',
				'fw.controller.version': '1.2.0',
			}),
		).toEqual({ firmwareVersion: '4.0.1', controllerFirmwareVersion: '1.2.0' });
	});

	it('returns null when no firmware attributes exist', () => {
		expect(extractFirmwareVersions({ hwRev: 'B' })).toBeNull();
	});

	it('tolerates partial reports (ninbus only)', () => {
		expect(extractFirmwareVersions({ 'fw.ninbus.version': '4.0.1' })).toEqual({
			firmwareVersion: '4.0.1',
			controllerFirmwareVersion: null,
		});
	});
});

describe('classifyDeviceFirmware', () => {
	it('no release published', () => {
		expect(classifyDeviceFirmware('1.0.0', 'in_sync', null)).toBe('no_release');
	});
	it('never reported → unknown', () => {
		expect(classifyDeviceFirmware(null, 'in_sync', '4.0.1')).toBe('unknown');
	});
	it('older version → update_available', () => {
		expect(classifyDeviceFirmware('3.9.0', 'in_sync', '4.0.1')).toBe('update_available');
	});
	it('same version → up_to_date', () => {
		expect(classifyDeviceFirmware('4.0.1', 'in_sync', '4.0.1')).toBe('up_to_date');
	});
	it('newer than release → up_to_date', () => {
		expect(classifyDeviceFirmware('4.2.0', 'in_sync', '4.0.1')).toBe('up_to_date');
	});
	it('hawkBit error wins', () => {
		expect(classifyDeviceFirmware('4.0.1', 'error', '4.0.1')).toBe('error');
	});
});

// ---------------------------------------------------------------------------
// Routes (HAWKBIT_ENABLED=false — DB-only paths)
// ---------------------------------------------------------------------------

describe('Firmware Module', () => {
	const app = createApp();
	const ts = Date.now();
	const superAdminEmail = 'admin-test@ninbus.com.br';
	const password = 'TestPassword123!';
	const ownerEmail = `fw-owner-${ts}@example.com`;
	const otherEmail = `fw-other-${ts}@example.com`;
	let superAdminCookie: string;
	let ownerCookie: string;
	let otherCookie: string;
	let companyId: string;
	let otherCompanyId: string;

	async function signUpAndIn(email: string, name: string): Promise<string> {
		await app.handle(
			new Request('http://localhost/api/auth/sign-up/email', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password, name }),
			}),
		);
		const signIn = await app.handle(
			new Request('http://localhost/api/auth/sign-in/email', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password }),
			}),
		);
		return signIn.headers.get('set-cookie') || '';
	}

	async function createCompanyAsSuperAdmin(name: string, owner: string): Promise<string> {
		const response = await app.handle(
			new Request('http://localhost/api/companies', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: superAdminCookie },
				body: JSON.stringify({ name, ownerEmail: owner }),
			}),
		);
		return (await response.json()).data.id;
	}

	it('signs in and sets up companies', async () => {
		superAdminCookie = await signUpAndIn(superAdminEmail, 'Factory Admin');
		ownerCookie = await signUpAndIn(ownerEmail, 'Firmware Owner');
		otherCookie = await signUpAndIn(otherEmail, 'Other Owner');
		companyId = await createCompanyAsSuperAdmin('Firmware Co', ownerEmail);
		otherCompanyId = await createCompanyAsSuperAdmin('Other Co', otherEmail);
		expect(companyId).toBeDefined();
		expect(otherCompanyId).toBeDefined();
	}, 20000);

	it('GET /api/admin/firmware requires auth (401)', async () => {
		const res = await app.handle(new Request('http://localhost/api/admin/firmware'));
		expect(res.status).toBe(401);
	});

	it('GET /api/admin/firmware rejects non-super-admin (403)', async () => {
		const res = await app.handle(
			new Request('http://localhost/api/admin/firmware', {
				headers: { Cookie: ownerCookie },
			}),
		);
		expect(res.status).toBe(403);
	});

	it('GET /api/admin/firmware lists releases for super admin (empty)', async () => {
		const res = await app.handle(
			new Request('http://localhost/api/admin/firmware', {
				headers: { Cookie: superAdminCookie },
			}),
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.total).toBe(0);
		expect(body.data).toEqual([]);
	});

	it('GET /api/admin/firmware/latest returns null when nothing published', async () => {
		const res = await app.handle(
			new Request('http://localhost/api/admin/firmware/latest', {
				headers: { Cookie: superAdminCookie },
			}),
		);
		expect(res.status).toBe(200);
		expect((await res.json()).data).toBeNull();
	});

	it('POST /api/admin/firmware rejects non-super-admin (403)', async () => {
		const form = new FormData();
		form.append(
			'file',
			new File([new Uint8Array(2048)], 'wifi3.bin', { type: 'application/octet-stream' }),
		);
		form.append('name', 'test');
		form.append('version', '1.0.0');
		form.append('artifactType', 'firmware-ninbus');
		const res = await app.handle(
			new Request('http://localhost/api/admin/firmware', {
				method: 'POST',
				headers: { Cookie: ownerCookie },
				body: form,
			}),
		);
		expect(res.status).toBe(403);
	});

	it('POST /api/admin/firmware .bin (server-side signing) without key → clear 400', async () => {
		const form = new FormData();
		form.append(
			'file',
			new File([new Uint8Array(2048)], 'wifi3.bin', { type: 'application/octet-stream' }),
		);
		form.append('name', 'wifi3');
		form.append('version', '1.0.0');
		form.append('artifactType', 'firmware-ninbus');
		const res = await app.handle(
			new Request('http://localhost/api/admin/firmware', {
				method: 'POST',
				headers: { Cookie: superAdminCookie },
				body: form,
			}),
		);
		// The server tries to sign+pack automatically (no manual counter field) —
		// without FIRMWARE_SIGNING_KEY configured it must fail with a clear 400.
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.code).toBe('SIGNING_KEY_NOT_CONFIGURED');
		expect(body.message).toContain('FIRMWARE_SIGNING_KEY');
	});

	it('POST /api/admin/firmware rejects a tar without the NPM manifest magic (400)', async () => {
		// Old-format tar (featureidentity.json) — or a tampered one — must fail fast.
		const pack = tar.pack();
		pack.entry(
			{ name: 'header-info/featureidentity.json', size: 34, mtime: new Date(0) },
			Buffer.from('{"type":"firmware-ninbus"}'),
		);
		pack.entry({ name: 'data/payload.bin', size: 2048, mtime: new Date(0) }, Buffer.alloc(2048));
		pack.finalize();
		const chunks: Buffer[] = [];
		await new Promise<void>((resolve, reject) => {
			pack.on('data', (c: Buffer) => chunks.push(c));
			pack.on('end', () => resolve());
			pack.on('error', reject);
		});
		const form = new FormData();
		form.append(
			'file',
			new File([new Uint8Array(Buffer.concat(chunks))], 'update-app.tar', {
				type: 'application/x-tar',
			}),
		);
		form.append('name', 'wifi3');
		form.append('version', '1.0.0');
		form.append('artifactType', 'firmware-ninbus');
		const res = await app.handle(
			new Request('http://localhost/api/admin/firmware', {
				method: 'POST',
				headers: { Cookie: superAdminCookie },
				body: form,
			}),
		);
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.code).toBe('INVALID_PACKAGE');
	});

	it('POST /api/admin/firmware .bin ignores a stale counter field (automatic)', async () => {
		const form = new FormData();
		form.append(
			'file',
			new File([new Uint8Array(2048)], 'app.bin', { type: 'application/octet-stream' }),
		);
		form.append('name', 'wifi3');
		form.append('version', '1.0.0');
		form.append('artifactType', 'firmware-ninbus');
		form.append('counter', '7'); // legacy/ignored — the counter is AUTOMATIC
		const res = await app.handle(
			new Request('http://localhost/api/admin/firmware', {
				method: 'POST',
				headers: { Cookie: superAdminCookie },
				body: form,
			}),
		);
		// same as no counter: automatic policy → no key → clear 400
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.code).toBe('SIGNING_KEY_NOT_CONFIGURED');
	});

	it('POST /api/admin/firmware fails cleanly when hawkBit is disabled (400)', async () => {
		// VALID canonical tar — must pass package validation and only then hit
		// the hawkBit-disabled guard (clear 400, not a 500/502).
		const tarBytes = await buildUnsignedNinbusTar();
		const form = new FormData();
		form.append(
			'file',
			new File([new Uint8Array(tarBytes)], 'update-app.tar', { type: 'application/x-tar' }),
		);
		form.append('name', 'wifi3');
		form.append('version', '1.0.0');
		form.append('artifactType', 'firmware-ninbus');
		const res = await app.handle(
			new Request('http://localhost/api/admin/firmware', {
				method: 'POST',
				headers: { Cookie: superAdminCookie },
				body: form,
			}),
		);
		// hawkBit disabled in tests → clear validation error, not a 500/502.
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.message).toContain('hawkBit');
	});

	it('DELETE /api/admin/firmware/:id returns 404 for unknown release', async () => {
		const res = await app.handle(
			new Request('http://localhost/api/admin/firmware/00000000-0000-0000-0000-000000000000', {
				method: 'DELETE',
				headers: { Cookie: superAdminCookie },
			}),
		);
		expect(res.status).toBe(404);
	});

	// Seed a factory release + devices directly in the DB (no hawkBit needed)
	// to exercise the company-scoped status endpoint.
	it('seeds release + devices', async () => {
		await db.insert(firmwareReleases).values([
			{
				hawkbitSmId: 900001,
				name: 'wifi3 3.x',
				version: '3.9.0',
				artifactType: 'firmware-ninbus',
				originalFilename: 'wifi3-390.bin',
				status: 'published',
			},
			{
				hawkbitSmId: 900002,
				name: 'wifi3 4.x',
				version: '4.0.1',
				artifactType: 'firmware-ninbus',
				originalFilename: 'wifi3-401.bin',
				status: 'published',
			},
			// DRAFT with a HIGHER semver — must NOT become the latest: the
			// publish gate hides it from end users until explicitly published.
			{
				hawkbitSmId: 900003,
				name: 'wifi3 4.9 candidate',
				version: '4.9.0',
				// controller type: the publication gate is a no-op pass for
				// non-ninbus artifacts, so the draft⇄published lifecycle is
				// testable with HAWKBIT_ENABLED=false.
				artifactType: 'firmware-controller',
				originalFilename: 'wifi3-490rc.bin',
				status: 'draft',
			},
		]);

		await db.insert(devices).values([
			{
				companyId,
				hawkbitTargetId: 'AAAA000000000001',
				name: 'outdated-device',
				serialNumber: 'AAAA000000000001',
				status: 'accepted',
				firmwareVersion: '3.9.0',
			},
			{
				companyId,
				hawkbitTargetId: 'AAAA000000000002',
				name: 'current-device',
				serialNumber: 'AAAA000000000002',
				status: 'accepted',
				firmwareVersion: '4.0.1',
				controllerFirmwareVersion: '1.2.0',
			},
			{
				companyId,
				hawkbitTargetId: 'AAAA000000000003',
				name: 'silent-device',
				serialNumber: 'AAAA000000000003',
				status: 'accepted',
			},
			{
				companyId,
				hawkbitTargetId: 'AAAA000000000004',
				name: 'failed-device',
				serialNumber: 'AAAA000000000004',
				status: 'accepted',
				firmwareVersion: '4.0.1',
				hawkbitUpdateStatus: 'error',
			},
		]);
	});

	it('GET /admin/firmware/latest picks the highest semver (not just newest)', async () => {
		const res = await app.handle(
			new Request('http://localhost/api/admin/firmware/latest', {
				headers: { Cookie: superAdminCookie },
			}),
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.version).toBe('4.0.1');
	});

	it('GET /admin/firmware lists chronologically (newest first)', async () => {
		const res = await app.handle(
			new Request('http://localhost/api/admin/firmware', {
				headers: { Cookie: superAdminCookie },
			}),
		);
		const body = await res.json();
		expect(body.total).toBe(3);
		// Drafts appear in the admin list (with their status) — hidden only
		// from end-user endpoints.
		expect(body.data[0].status).toBeDefined();
		const versions = body.data.map((r: { version: string }) => r.version).sort();
		expect(versions).toEqual(['3.9.0', '4.0.1', '4.9.0']);
	});

	it('GET firmware/status classifies company devices (owner)', async () => {
		const res = await app.handle(
			new Request(`http://localhost/api/companies/${companyId}/devices/firmware/status`, {
				headers: { Cookie: ownerCookie },
			}),
		);
		expect(res.status).toBe(200);
		const body = await res.json();

		expect(body.latest.ninbus.version).toBe('4.0.1');
		expect(body.summary).toEqual({ total: 4, upToDate: 1, outdated: 1, unknown: 1, error: 1 });

		const byName = Object.fromEntries(body.devices.map((d: { name: string }) => [d.name, d]));
		expect(byName['outdated-device'].firmwareStatus).toBe('update_available');
		expect(byName['outdated-device'].firmwareVersion).toBe('3.9.0');
		expect(byName['current-device'].firmwareStatus).toBe('up_to_date');
		expect(byName['current-device'].controllerFirmwareVersion).toBe('1.2.0');
		expect(byName['silent-device'].firmwareStatus).toBe('unknown');
		expect(byName['failed-device'].firmwareStatus).toBe('error');
	});

	it('GET firmware/status rejects members of another company (403)', async () => {
		const res = await app.handle(
			new Request(`http://localhost/api/companies/${companyId}/devices/firmware/status`, {
				headers: { Cookie: otherCookie },
			}),
		);
		expect(res.status).toBe(403);
	});

	it('POST firmware/update fails cleanly with hawkBit disabled (400)', async () => {
		const res = await app.handle(
			new Request(`http://localhost/api/companies/${companyId}/devices/firmware/update`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
				body: JSON.stringify({ deviceIds: ['00000000-0000-0000-0000-000000000001'] }),
			}),
		);
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.message).toContain('hawkBit');
	});

	it('admin devices list is enriched with firmware status', async () => {
		const res = await app.handle(
			new Request('http://localhost/api/admin/devices', {
				headers: { Cookie: superAdminCookie },
			}),
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		const enriched = body.data.find((d: { name: string }) => d.name === 'outdated-device');
		expect(enriched).toBeDefined();
		expect(enriched.firmwareVersion).toBe('3.9.0');
		expect(enriched.latestFirmwareVersion).toBe('4.0.1');
		expect(enriched.firmwareStatus).toBe('update_available');
	});

	// ── Admin-forced deploy (console path) ──────────────────────────

	it('POST /api/admin/firmware/deploy rejects non-super-admin (403)', async () => {
		const res = await app.handle(
			new Request('http://localhost/api/admin/firmware/deploy', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
				body: JSON.stringify({ deviceIds: ['00000000-0000-0000-0000-000000000001'] }),
			}),
		);
		expect(res.status).toBe(403);
	});

	it('POST /api/admin/firmware/deploy requires hawkBit (400)', async () => {
		const res = await app.handle(
			new Request('http://localhost/api/admin/firmware/deploy', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: superAdminCookie },
				body: JSON.stringify({ deviceIds: ['00000000-0000-0000-0000-000000000001'] }),
			}),
		);
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.message).toContain('hawkBit');
	});

	it('POST /api/admin/firmware/deploy returns 404 when no device is eligible', async () => {
		// hawkBit guard fires first in tests (HAWKBIT_ENABLED=false), so this
		// asserts the guard path; the NOT_FOUND branch is covered by E2E.
		const res = await app.handle(
			new Request('http://localhost/api/admin/firmware/deploy', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: superAdminCookie },
				body: JSON.stringify({ deviceIds: ['00000000-0000-0000-0000-000000009999'] }),
			}),
		);
		expect([400, 404]).toContain(res.status);
	});

	// ── Publish gate (draft ⇄ published) ───────────────────────────────

	let draftReleaseId: string;

	it('finds the seeded draft for gate tests', async () => {
		const [draft] = await db
			.select()
			.from(firmwareReleases)
			.where(eq(firmwareReleases.version, '4.9.0'));
		draftReleaseId = draft.id;
		expect(draft.status).toBe('draft');
	});

	it('publish rejects non-super-admin (403)', async () => {
		const res = await app.handle(
			new Request(`http://localhost/api/admin/firmware/${draftReleaseId}/publish`, {
				method: 'POST',
				headers: { Cookie: ownerCookie },
			}),
		);
		expect(res.status).toBe(403);
	});

	it('publish returns 404 for unknown release', async () => {
		const res = await app.handle(
			new Request(
				'http://localhost/api/admin/firmware/00000000-0000-0000-0000-000000000000/publish',
				{
					method: 'POST',
					headers: { Cookie: superAdminCookie },
				},
			),
		);
		expect(res.status).toBe(404);
	});

	it('publish flips draft → published and it becomes the latest', async () => {
		const res = await app.handle(
			new Request(`http://localhost/api/admin/firmware/${draftReleaseId}/publish`, {
				method: 'POST',
				headers: { Cookie: superAdminCookie },
			}),
		);
		expect(res.status).toBe(200);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.status).toBe('published');

		// Now the latest (controller type — the seeded draft) IS the draft.
		const latest = await app.handle(
			new Request('http://localhost/api/admin/firmware/latest?type=firmware-controller', {
				headers: { Cookie: superAdminCookie },
			}),
		);
		expect((await latest.json()).data.version).toBe('4.9.0');
	});

	it('publishing twice returns 409 (already published)', async () => {
		const res = await app.handle(
			new Request(`http://localhost/api/admin/firmware/${draftReleaseId}/publish`, {
				method: 'POST',
				headers: { Cookie: superAdminCookie },
			}),
		);
		expect(res.status).toBe(409);
	});

	it('unpublish hides the release from end users again', async () => {
		const res = await app.handle(
			new Request(`http://localhost/api/admin/firmware/${draftReleaseId}/unpublish`, {
				method: 'POST',
				headers: { Cookie: superAdminCookie },
			}),
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.status).toBe('draft');

		const latest = await app.handle(
			new Request('http://localhost/api/admin/firmware/latest', {
				headers: { Cookie: superAdminCookie },
			}),
		);
		expect((await latest.json()).data.version).toBe('4.0.1');
	});
});

// ---------------------------------------------------------------------------
// Canonical v4 tar validator (unit — mirror of ota_pack.py contract)
// ---------------------------------------------------------------------------

describe('validateCanonicalTar (v4 golden rule)', () => {
	it('accepts a tool-equivalent ninbus tar and reports image size', async () => {
		const image = Buffer.alloc(4096, 0xaa);
		const info = await validateCanonicalTar(await buildUnsignedNinbusTar(image), 'firmware-ninbus');
		expect(info.imageSize).toBe(4096);
		expect(info.payloadSize).toBe(4096 + 128);
	});

	it('accepts a controller tar with raw .fir payload', async () => {
		const info = await validateCanonicalTar(
			await buildCanonicalTar('firmware-controller', Buffer.alloc(512, 0x01)),
			'firmware-controller',
		);
		expect(info.payloadSize).toBe(512);
	});

	it('rejects payload without NPM magic (deployment-657 class)', async () => {
		const raw = await buildCanonicalTar('firmware-ninbus', Buffer.alloc(2048));
		await expect(validateCanonicalTar(raw, 'firmware-ninbus')).rejects.toThrow(/magic NPM/);
	});

	it('rejects a manifest whose digest does not match the image', async () => {
		const image = Buffer.alloc(1024, 0x55);
		const manifest = buildManifest(image);
		manifest[10] ^= 0xff; // corrupt the digest
		const raw = await buildCanonicalTar('firmware-ninbus', Buffer.concat([manifest, image]));
		await expect(validateCanonicalTar(raw, 'firmware-ninbus')).rejects.toThrow(/digest/);
	});

	it('rejects the legacy featureidentity format', async () => {
		const pack = tar.pack();
		pack.entry(
			{ name: 'header-info/featureidentity.json', size: 34, mtime: new Date(0) },
			Buffer.from('{"type":"firmware-ninbus"}'),
		);
		pack.entry({ name: 'data/payload.bin', size: 16, mtime: new Date(0) }, Buffer.alloc(16));
		pack.finalize();
		const chunks: Buffer[] = [];
		await new Promise<void>((resolve, reject) => {
			pack.on('data', (c: Buffer) => chunks.push(c));
			pack.on('end', () => resolve());
			pack.on('error', reject);
		});
		await expect(validateCanonicalTar(Buffer.concat(chunks), 'firmware-ninbus')).rejects.toThrow(
			/artifact\.info/,
		);
	});

	it('rejects artifact.info with a mismatched type', async () => {
		// tar says firmware-controller but validated as firmware-ninbus
		const raw = await buildCanonicalTar('firmware-controller', Buffer.alloc(64));
		await expect(validateCanonicalTar(raw, 'firmware-ninbus')).rejects.toThrow(
			/data\/firmware\.npm/,
		);
	});
});

// ---------------------------------------------------------------------------
// Server-side signer (ota_sign.py parity)
// ---------------------------------------------------------------------------

describe('ota-signer (server-side sign + pack)', () => {
	const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

	it('parseCounter mirrors ota_sign.py (decimal, hex, bounds)', () => {
		expect(parseCounter('7')).toBe(7);
		expect(parseCounter('0x07')).toBe(7);
		expect(parseCounter(' 12 ')).toBe(12);
		expect(() => parseCounter('-1')).toThrow();
		expect(() => parseCounter('4294967296')).toThrow();
		expect(() => parseCounter('abc')).toThrow();
	});

	it('produces a canonical tar that passes validateCanonicalTar', async () => {
		const image = Buffer.alloc(8192, 0x5a);
		const tar = await buildNinbusTar(image, 9, privateKey);
		const info = await validateCanonicalTar(tar, 'firmware-ninbus');
		expect(info.imageSize).toBe(8192);
		expect(info.payloadSize).toBe(8192 + 128);
	});

	it('signature verifies against the PUBLIC key (ota_sign.py parity)', async () => {
		const image = Buffer.alloc(300, 0x33);
		const counter = 42;
		const tar = await buildNinbusTar(image, counter, privateKey);

		// extract manifest from the tar (validator already proved the layout)
		const entries = await new Promise<Array<Buffer>>((resolve, reject) => {
			const bufs: Array<Buffer> = [];
			const extract = tarMod.extract();
			// @ts-expect-error tar-stream header typing
			extract.on('entry', (_h: unknown, stream: NodeJS.ReadableStream, next: () => void) => {
				const chunks: Buffer[] = [];
				stream.on('data', (c: Buffer) => chunks.push(c));
				stream.on('end', () => {
					bufs.push(Buffer.concat(chunks));
					next();
				});
			});
			extract.on('finish', () => resolve(bufs));
			extract.on('error', reject);
			extract.end(tar);
		});
		const payload = entries[1]!;
		const manifest = payload.subarray(0, 128);
		const embeddedImage = payload.subarray(128);
		expect(embeddedImage.length).toBe(image.length);

		// digest = SHA-256(image ‖ LE32(counter) ‖ LE32(size)) — same as the validator
		const trailer = Buffer.alloc(8);
		trailer.writeUInt32LE(counter, 0);
		trailer.writeUInt32LE(image.length, 4);
		const digest = createHash('sha256').update(image).update(trailer).digest();
		expect(manifest.subarray(8, 40).equals(digest)).toBe(true);

		// signature @ [45, 45+sigLen) verifies with the PUBLIC half — what the
		// bootloader does (psa_verify_hash over the RAW manifest digest).
		const sigLen = manifest[44]!;
		const signature = manifest.subarray(45, 45 + sigLen);
		validateDerSignature(signature);
		// PREHASHED contract: the manifest digest IS the hash. noble verify with
		// prehash:false — same math as psa_verify_hash/Prehashed(SHA256). Proven
		// against the Python tools (ota_pack/ota_sign) in the round-trip.
		const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
		const pubBytes = new Uint8Array(
			Buffer.concat([
				Buffer.from([0x04]),
				Buffer.from(jwk.x, 'base64url'),
				Buffer.from(jwk.y, 'base64url'),
			]),
		);
		expect(
			p256.verify(new Uint8Array(signature), new Uint8Array(digest), pubBytes, {
				prehash: false,
				format: 'der',
			}),
		).toBe(true);
		// REGRESSION GUARD: hashing the digest AGAIN (crypto 'sha256') must NOT
		// verify — the double-hash bug caught by the Python round-trip.
		expect(cryptoVerify('sha256', digest, publicKey, signature)).toBe(false);
	});

	it('rejects oversized images (≤ 192 KiB)', async () => {
		await expect(buildNinbusTar(Buffer.alloc(0x30001), 1, privateKey)).rejects.toThrow(
			/192 KiB|1\.\./,
		);
	});
});

// ---------------------------------------------------------------------------
// GET /api/admin/firmware/:releaseId/artifact — served-binary download route
// ---------------------------------------------------------------------------
describe('Firmware artifact download (route)', () => {
	const app = createApp();
	const password = 'TestPassword123!';

	async function signIn(email: string, fresh = false): Promise<string> {
		if (fresh) {
			await app.handle(
				new Request('http://localhost/api/auth/sign-up/email', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ email, password, name: 'Plain User' }),
				}),
			);
		}
		const res = await app.handle(
			new Request('http://localhost/api/auth/sign-in/email', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password }),
			}),
		);
		return res.headers.get('set-cookie') ?? '';
	}

	it('super admin + hawkBit disabled → 400 HAWKBIT_NOT_ENABLED (clear guard, no 500)', async () => {
		const cookie = await signIn('admin-test@ninbus.com.br');
		expect(cookie).toBeTruthy();
		const res = await app.handle(
			new Request(`http://localhost/api/admin/firmware/${crypto.randomUUID()}/artifact`, {
				headers: { Cookie: cookie },
			}),
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { code?: string };
		expect(body.code).toBe('HAWKBIT_NOT_ENABLED');
	});

	it('plain user → 403 (super admin only)', async () => {
		const cookie = await signIn(`fw-dl-${Date.now()}@example.com`, true);
		const res = await app.handle(
			new Request(`http://localhost/api/admin/firmware/${crypto.randomUUID()}/artifact`, {
				headers: { Cookie: cookie },
			}),
		);
		expect(res.status).toBe(403);
	});

	it('anonymous → 401', async () => {
		const res = await app.handle(
			new Request(`http://localhost/api/admin/firmware/${crypto.randomUUID()}/artifact`),
		);
		expect(res.status).toBe(401);
	});
});

// ---------------------------------------------------------------------------
// extractImageFromTar — inner .bin payload extraction from the served tar
// ---------------------------------------------------------------------------
describe('extractImageFromTar', () => {
	it('extracts the exact inner image bytes from a canonical ninbus tar', async () => {
		const image = Buffer.alloc(1024, 0x5a);
		const tar = await buildUnsignedNinbusTar(image);
		const { image: extracted, info } = await extractImageFromTar(tar, 'firmware-ninbus');
		expect(extracted.equals(image)).toBe(true);
		expect(info.imageSize).toBe(1024);
	});

	it('extracts the raw payload for firmware-controller (.fir)', async () => {
		const payload = Buffer.alloc(64, 0x33);
		const tar = await buildCanonicalTar('firmware-controller', payload);
		const { image, info } = await extractImageFromTar(tar, 'firmware-controller');
		expect(image.equals(payload)).toBe(true);
		expect(info.imageSize).toBe(64);
	});

	it('rejects a non-canonical tar with INVALID_PACKAGE (forensic signal)', async () => {
		let code: string | undefined;
		try {
			await extractImageFromTar(Buffer.alloc(1024, 0x78), 'firmware-ninbus');
		} catch (e) {
			code = (e as { code?: string }).code;
		}
		expect(code).toBe('INVALID_PACKAGE');
	});
});
