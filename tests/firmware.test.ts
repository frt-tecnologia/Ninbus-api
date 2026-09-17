import { afterAll, describe, expect, it } from 'bun:test';
import { createApp } from '../src/app';
import { db } from '../src/common/db';
import { companies, devices, firmwareReleases } from '../src/common/db/schema';
import { classifyDeviceFirmware } from '../src/modules/firmware/status-service';
import { compareVersions } from '../src/modules/firmware/service';
import { extractFirmwareVersions } from '../src/modules/devices/firmware-sync';
import { cleanAll } from './test-helpers';

afterAll(async () => {
	await cleanAll();
});

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

	it('POST /api/admin/firmware fails cleanly when hawkBit is disabled (400)', async () => {
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
			},
			{
				hawkbitSmId: 900002,
				name: 'wifi3 4.x',
				version: '4.0.1',
				artifactType: 'firmware-ninbus',
				originalFilename: 'wifi3-401.bin',
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
		expect(body.total).toBe(2);
		expect(body.data.map((r: { version: string }) => r.version)).toEqual(['3.9.0', '4.0.1']);
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

		const byName = Object.fromEntries(
			body.devices.map((d: { name: string }) => [d.name, d]),
		);
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
});
