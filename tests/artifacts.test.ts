import { beforeEach, describe, expect, it } from 'bun:test';
import { createApp } from '../src/app';
import {
	type MenderArtifact,
	NINBUS_ARTIFACT_TYPES,
	NINBUS_ARTIFACT_TYPE_META,
} from '../src/common/mender/client';
import {
	ArtifactValidationError,
	enrichArtifact,
	validateFileExtension,
	validateFileSize,
} from '../src/modules/artifacts/service';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

const _TEST_COMPANY_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const TEST_USER_EMAIL = `artifact-test-${Date.now()}@example.com`;
const TEST_PASSWORD = 'TestPassword123!';
const TEST_USER_NAME = 'Artifact Tester';

async function signUpAndSignIn(app: ReturnType<typeof createApp>) {
	// Sign up
	await app.handle(
		new Request('http://localhost/api/auth/sign-up/email', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				email: TEST_USER_EMAIL,
				password: TEST_PASSWORD,
				name: TEST_USER_NAME,
			}),
		}),
	);

	// Sign in and get cookie
	const signInResponse = await app.handle(
		new Request('http://localhost/api/auth/sign-in/email', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				email: TEST_USER_EMAIL,
				password: TEST_PASSWORD,
			}),
		}),
	);

	const setCookie = signInResponse.headers.get('set-cookie');
	return setCookie!;
}

async function createTestCompany(app: ReturnType<typeof createApp>, cookie: string) {
	const response = await app.handle(
		new Request('http://localhost/api/companies', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Cookie: cookie,
			},
			body: JSON.stringify({ name: 'Test Artifact Company' }),
		}),
	);
	const body = await response.json();
	return body.data.id;
}

function createMockMenderFile(
	name = 'test-firmware-1.0.0.mender',
	content = 'fake-mender-artifact-content',
): File {
	return new File([content], name, { type: 'application/octet-stream' });
}

function buildMultipartBody(file: File, description?: string): FormData {
	const formData = new FormData();
	formData.append('artifact', file);
	if (description) {
		formData.append('description', description);
	}
	return formData;
}

// ---------------------------------------------------------------------------
// Unit Tests — Service Validation Functions
// ---------------------------------------------------------------------------

describe('Artifacts Service — Validation', () => {
	describe('validateFileExtension', () => {
		it('accepts .mender extension', () => {
			expect(validateFileExtension('firmware-1.0.0.mender')).toBe('.mender');
		});

		it('accepts .mender extension (case insensitive)', () => {
			expect(validateFileExtension('firmware-1.0.0.MENDER')).toBe('.mender');
		});

		it('accepts .mender extension (mixed case)', () => {
			expect(validateFileExtension('firmware-1.0.0.Mender')).toBe('.mender');
		});

		it('rejects .zip extension', () => {
			expect(() => validateFileExtension('firmware.zip')).toThrow(ArtifactValidationError);
		});

		it('rejects .bin extension', () => {
			expect(() => validateFileExtension('firmware.bin')).toThrow(ArtifactValidationError);
		});

		it('rejects .fir extension (raw payload, not a Mender artifact)', () => {
			expect(() => validateFileExtension('firmware.fir')).toThrow(ArtifactValidationError);
		});

		it('rejects no extension', () => {
			expect(() => validateFileExtension('firmware')).toThrow(ArtifactValidationError);
		});

		it('rejects empty filename', () => {
			expect(() => validateFileExtension('')).toThrow(ArtifactValidationError);
		});

		it('error message includes allowed extensions', () => {
			try {
				validateFileExtension('test.zip');
			} catch (error) {
				expect(error).toBeInstanceOf(ArtifactValidationError);
				expect((error as ArtifactValidationError).code).toBe('INVALID_EXTENSION');
				expect((error as ArtifactValidationError).message).toContain('.mender');
			}
		});
	});

	describe('validateFileSize', () => {
		it('accepts valid file size', () => {
			expect(validateFileSize(1024)).toBe(1024);
		});

		it('accepts maximum allowed size (500 MB)', () => {
			const maxSize = 500 * 1024 * 1024;
			expect(validateFileSize(maxSize)).toBe(maxSize);
		});

		it('accepts 1 byte', () => {
			expect(validateFileSize(1)).toBe(1);
		});

		it('rejects zero size', () => {
			expect(() => validateFileSize(0)).toThrow(ArtifactValidationError);
			try {
				validateFileSize(0);
			} catch (error) {
				expect((error as ArtifactValidationError).code).toBe('EMPTY_FILE');
			}
		});

		it('rejects negative size', () => {
			expect(() => validateFileSize(-1)).toThrow(ArtifactValidationError);
		});

		it('rejects size over 500 MB', () => {
			const overMax = 500 * 1024 * 1024 + 1;
			expect(() => validateFileSize(overMax)).toThrow(ArtifactValidationError);
			try {
				validateFileSize(overMax);
			} catch (error) {
				expect((error as ArtifactValidationError).code).toBe('FILE_TOO_LARGE');
			}
		});

		it('error message includes max size in MB', () => {
			try {
				validateFileSize(500 * 1024 * 1024 + 1);
			} catch (error) {
				expect((error as ArtifactValidationError).message).toContain('500');
			}
		});
	});

	describe('enrichArtifact', () => {
		it('enriches a Ninbus firmware artifact (type from updates[0].type_info.type)', () => {
			const artifact: MenderArtifact = {
				id: 'test-id',
				name: 'ninbus-firmware-3.3.0',
				description: 'Test firmware',
				device_types_compatible: ['ninbus-wifi-v3'],
				size: 1024,
				modified: '2026-04-14T00:00:00Z',
				updates: [
					{
						type_info: { type: 'firmware-ninbus' },
						files: [{ name: 'firmware.fir', checksum: 'abc123', size: 1024 }],
					},
				],
			};

			const enriched = enrichArtifact(artifact);

			expect(enriched.ninbusType).toBe('firmware-ninbus');
			expect(enriched.ninbusMeta).toEqual(NINBUS_ARTIFACT_TYPE_META['firmware-ninbus']);
			expect(enriched.ninbusMeta?.riskLevel).toBe('high');
			expect(enriched.ninbusMeta?.requiresReboot).toBe(true);
		});

		it('enriches a controller firmware artifact', () => {
			const artifact: MenderArtifact = {
				id: 'test-id',
				name: 'controller-12.6.0',
				device_types_compatible: ['ninbus-wifi-v3'],
				size: 512,
				modified: '2026-04-14T00:00:00Z',
				updates: [{ type_info: { type: 'firmware-controller' } }],
			};

			const enriched = enrichArtifact(artifact);

			expect(enriched.ninbusType).toBe('firmware-controller');
			expect(enriched.ninbusMeta?.riskLevel).toBe('medium');
			expect(enriched.ninbusMeta?.requiresReboot).toBe(false);
		});

		it('enriches an NFX configuration artifact', () => {
			const artifact: MenderArtifact = {
				id: 'test-id',
				name: 'config-nfx-2026-04-14',
				device_types_compatible: ['ninbus-wifi-v3'],
				size: 256,
				modified: '2026-04-14T00:00:00Z',
				updates: [{ type_info: { type: 'configuration-nfx' } }],
			};

			const enriched = enrichArtifact(artifact);

			expect(enriched.ninbusType).toBe('configuration-nfx');
			expect(enriched.ninbusMeta?.riskLevel).toBe('low');
		});

		it('returns null type for unknown artifact types (e.g. rootfs-image)', () => {
			const artifact: MenderArtifact = {
				id: 'test-id',
				name: 'unknown-artifact',
				device_types_compatible: ['other-device'],
				size: 100,
				modified: '2026-04-14T00:00:00Z',
				updates: [{ type_info: { type: 'rootfs-image' } }],
			};

			const enriched = enrichArtifact(artifact);

			expect(enriched.ninbusType).toBeNull();
			expect(enriched.ninbusMeta).toBeNull();
		});

		it('returns null type when no updates array', () => {
			const artifact: MenderArtifact = {
				id: 'test-id',
				name: 'no-type-artifact',
				device_types_compatible: ['ninbus-wifi-v3'],
				size: 100,
				modified: '2026-04-14T00:00:00Z',
			};

			const enriched = enrichArtifact(artifact);

			expect(enriched.ninbusType).toBeNull();
			expect(enriched.ninbusMeta).toBeNull();
		});

		it('preserves all original artifact fields', () => {
			const artifact: MenderArtifact = {
				id: 'test-id-123',
				name: 'test-artifact',
				description: 'Test description',
				device_types_compatible: ['ninbus-wifi-v3'],
				size: 4096,
				modified: '2026-04-14T00:00:00Z',
				updates: [
					{
						type_info: { type: 'firmware-ninbus' },
						files: [{ name: 'app.fir', checksum: 'sha256:deadbeef', size: 4096 }],
					},
				],
			};

			const enriched = enrichArtifact(artifact);

			expect(enriched.id).toBe('test-id-123');
			expect(enriched.name).toBe('test-artifact');
			expect(enriched.description).toBe('Test description');
			expect(enriched.size).toBe(4096);
			expect(enriched.device_types_compatible).toEqual(['ninbus-wifi-v3']);
		});

		it('falls back to artifact_provides.type for v3 artifacts', () => {
			const artifact: MenderArtifact = {
				id: 'test-id',
				name: 'legacy-v3-artifact',
				device_types_compatible: ['ninbus-wifi-v3'],
				size: 2048,
				modified: '2026-04-14T00:00:00Z',
				artifact_provides: { type: 'firmware-controller' },
			};

			const enriched = enrichArtifact(artifact);

			expect(enriched.ninbusType).toBe('firmware-controller');
			expect(enriched.ninbusMeta?.riskLevel).toBe('medium');
		});
	});
});

// ---------------------------------------------------------------------------
// Integration Tests — API Endpoints
// ---------------------------------------------------------------------------

describe('Artifacts Module — API Endpoints', () => {
	const app = createApp();
	let cookie: string;
	let companyId: string;

	beforeEach(async () => {
		cookie = await signUpAndSignIn(app);
		companyId = await createTestCompany(app, cookie);
	});

	// -----------------------------------------------------------------------
	// GET /types
	// -----------------------------------------------------------------------

	describe('GET /api/companies/:companyId/artifacts/types', () => {
		it('returns 200 with all three artifact types', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/types`, {
					method: 'GET',
					headers: { Cookie: cookie },
				}),
			);

			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.data).toBeDefined();
			expect(body.data.length).toBe(3);
		});

		it('each type has required metadata fields', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/types`, {
					method: 'GET',
					headers: { Cookie: cookie },
				}),
			);

			const body = await response.json();
			for (const type of body.data) {
				expect(type.type).toBeDefined();
				expect(type.label).toBeDefined();
				expect(type.description).toBeDefined();
				expect(type.target).toBeDefined();
				expect(type.requiresReboot).toBeDefined();
				expect(typeof type.requiresReboot).toBe('boolean');
				expect(type.riskLevel).toBeDefined();
				expect(['low', 'medium', 'high']).toContain(type.riskLevel);
			}
		});

		it('returns firmware-ninbus with high risk and reboot', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/types`, {
					method: 'GET',
					headers: { Cookie: cookie },
				}),
			);

			const body = await response.json();
			const ninbusFw = body.data.find((t: any) => t.type === 'firmware-ninbus');
			expect(ninbusFw).toBeDefined();
			expect(ninbusFw.riskLevel).toBe('high');
			expect(ninbusFw.requiresReboot).toBe(true);
		});

		it('returns firmware-controller with medium risk and no reboot', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/types`, {
					method: 'GET',
					headers: { Cookie: cookie },
				}),
			);

			const body = await response.json();
			const controller = body.data.find((t: any) => t.type === 'firmware-controller');
			expect(controller).toBeDefined();
			expect(controller.riskLevel).toBe('medium');
			expect(controller.requiresReboot).toBe(false);
		});

		it('returns configuration-nfx with low risk and no reboot', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/types`, {
					method: 'GET',
					headers: { Cookie: cookie },
				}),
			);

			const body = await response.json();
			const nfx = body.data.find((t: any) => t.type === 'configuration-nfx');
			expect(nfx).toBeDefined();
			expect(nfx.riskLevel).toBe('low');
			expect(nfx.requiresReboot).toBe(false);
		});

		it('returns 401 without authentication', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/types`, {
					method: 'GET',
				}),
			);
			expect(response.status).toBe(401);
		});

		it('returns 403 for non-member', async () => {
			// Create a second user who is NOT a member
			const otherEmail = `non-member-${Date.now()}@example.com`;
			await app.handle(
				new Request('http://localhost/api/auth/sign-up/email', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						email: otherEmail,
						password: TEST_PASSWORD,
						name: 'Non Member',
					}),
				}),
			);
			const signInResp = await app.handle(
				new Request('http://localhost/api/auth/sign-in/email', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						email: otherEmail,
						password: TEST_PASSWORD,
					}),
				}),
			);
			const otherCookie = signInResp.headers.get('set-cookie')!;

			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/types`, {
					method: 'GET',
					headers: { Cookie: otherCookie },
				}),
			);

			expect(response.status).toBe(403);
		});
	});

	// -----------------------------------------------------------------------
	// POST / (Upload)
	// -----------------------------------------------------------------------

	describe('POST /api/companies/:companyId/artifacts', () => {
		it('returns 401 without authentication', async () => {
			const formData = buildMultipartBody(createMockMenderFile());

			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts`, {
					method: 'POST',
					body: formData,
				}),
			);

			expect(response.status).toBe(401);
		});

		it('returns 403 for non-member', async () => {
			const otherEmail = `non-member-upload-${Date.now()}@example.com`;
			await app.handle(
				new Request('http://localhost/api/auth/sign-up/email', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						email: otherEmail,
						password: TEST_PASSWORD,
						name: 'Non Member',
					}),
				}),
			);
			const signInResp = await app.handle(
				new Request('http://localhost/api/auth/sign-in/email', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						email: otherEmail,
						password: TEST_PASSWORD,
					}),
				}),
			);
			const otherCookie = signInResp.headers.get('set-cookie')!;

			const formData = buildMultipartBody(createMockMenderFile());

			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts`, {
					method: 'POST',
					headers: { Cookie: otherCookie },
					body: formData,
				}),
			);

			expect(response.status).toBe(403);
		});

		it('returns 400 when artifact file is missing', async () => {
			const formData = new FormData();
			formData.append('description', 'Test without file');

			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts`, {
					method: 'POST',
					headers: { Cookie: cookie },
					body: formData,
				}),
			);

			expect(response.status).toBe(400);
		});

		it('returns 400 for invalid companyId', async () => {
			const formData = buildMultipartBody(createMockMenderFile());

			const response = await app.handle(
				new Request('http://localhost/api/companies/not-a-uuid/artifacts', {
					method: 'POST',
					headers: { Cookie: cookie },
					body: formData,
				}),
			);

			expect(response.status).toBe(400);
		});

		// Note: The following tests would require a running Mender Gateway
		// In CI/CD, these would be integration tests with a mock/stub Mender server.
		// The validation tests (extension, size) are covered in the unit tests above.
	});

	// -----------------------------------------------------------------------
	// GET / (List)
	// -----------------------------------------------------------------------

	describe('GET /api/companies/:companyId/artifacts', () => {
		it('returns 401 without authentication', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts`, { method: 'GET' }),
			);
			expect(response.status).toBe(401);
		});

		it('returns 403 for non-member', async () => {
			const otherEmail = `non-member-list-${Date.now()}@example.com`;
			await app.handle(
				new Request('http://localhost/api/auth/sign-up/email', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						email: otherEmail,
						password: TEST_PASSWORD,
						name: 'Non Member',
					}),
				}),
			);
			const signInResp = await app.handle(
				new Request('http://localhost/api/auth/sign-in/email', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						email: otherEmail,
						password: TEST_PASSWORD,
					}),
				}),
			);
			const otherCookie = signInResp.headers.get('set-cookie')!;

			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts`, {
					method: 'GET',
					headers: { Cookie: otherCookie },
				}),
			);

			expect(response.status).toBe(403);
		});

		it('returns 400 for invalid companyId', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/companies/not-a-uuid/artifacts', {
					method: 'GET',
					headers: { Cookie: cookie },
				}),
			);
			expect(response.status).toBe(400);
		});
	});

	// -----------------------------------------------------------------------
	// GET /:artifactId
	// -----------------------------------------------------------------------

	describe('GET /api/companies/:companyId/artifacts/:artifactId', () => {
		it('returns 401 without authentication', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/some-artifact-id`, {
					method: 'GET',
				}),
			);
			expect(response.status).toBe(401);
		});

		it('returns 400 for invalid companyId', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/companies/not-a-uuid/artifacts/some-id', {
					method: 'GET',
					headers: { Cookie: cookie },
				}),
			);
			expect(response.status).toBe(400);
		});
	});

	// -----------------------------------------------------------------------
	// DELETE /:artifactId
	// -----------------------------------------------------------------------

	describe('DELETE /api/companies/:companyId/artifacts/:artifactId', () => {
		it('returns 401 without authentication', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/some-artifact-id`, {
					method: 'DELETE',
				}),
			);
			expect(response.status).toBe(401);
		});

		it('returns 400 for invalid companyId', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/companies/not-a-uuid/artifacts/some-id', {
					method: 'DELETE',
					headers: { Cookie: cookie },
				}),
			);
			expect(response.status).toBe(400);
		});
	});

	// -----------------------------------------------------------------------
	// PUT /:artifactId (Update)
	// -----------------------------------------------------------------------

	describe('PUT /api/companies/:companyId/artifacts/:artifactId', () => {
		it('returns 401 without authentication', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/some-artifact-id`, {
					method: 'PUT',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({ description: 'Updated description' }),
				}),
			);
			expect(response.status).toBe(401);
		});

		it('returns 400 for invalid companyId', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/companies/not-a-uuid/artifacts/some-id', {
					method: 'PUT',
					headers: {
						'Content-Type': 'application/json',
						Cookie: cookie,
					},
					body: JSON.stringify({ description: 'Updated' }),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('returns 400 when description is empty', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/some-id`, {
					method: 'PUT',
					headers: {
						'Content-Type': 'application/json',
						Cookie: cookie,
					},
					body: JSON.stringify({ description: '' }),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('returns 400 when description exceeds maxLength', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/some-id`, {
					method: 'PUT',
					headers: {
						'Content-Type': 'application/json',
						Cookie: cookie,
					},
					body: JSON.stringify({ description: 'x'.repeat(1001) }),
				}),
			);
			expect(response.status).toBe(400);
		});

		it('returns 400 when body is empty', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/some-id`, {
					method: 'PUT',
					headers: {
						'Content-Type': 'application/json',
						Cookie: cookie,
					},
					body: JSON.stringify({}),
				}),
			);
			expect(response.status).toBe(400);
		});
	});

	// -----------------------------------------------------------------------
	// GET /:artifactId/download
	// -----------------------------------------------------------------------

	describe('GET /api/companies/:companyId/artifacts/:artifactId/download', () => {
		it('returns 401 without authentication', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/some-id/download`, {
					method: 'GET',
				}),
			);
			expect(response.status).toBe(401);
		});

		it('returns 400 for invalid companyId', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/companies/not-a-uuid/artifacts/some-id/download', {
					method: 'GET',
					headers: { Cookie: cookie },
				}),
			);
			expect(response.status).toBe(400);
		});
	});

	// -----------------------------------------------------------------------
	// GET /releases
	// -----------------------------------------------------------------------

	describe('GET /api/companies/:companyId/artifacts/releases', () => {
		it('returns 401 without authentication', async () => {
			const response = await app.handle(
				new Request(`http://localhost/api/companies/${companyId}/artifacts/releases`, {
					method: 'GET',
				}),
			);
			expect(response.status).toBe(401);
		});

		it('returns 400 for invalid companyId', async () => {
			const response = await app.handle(
				new Request('http://localhost/api/companies/not-a-uuid/artifacts/releases', {
					method: 'GET',
					headers: { Cookie: cookie },
				}),
			);
			expect(response.status).toBe(400);
		});
	});
});

// ---------------------------------------------------------------------------
// ArtifactValidationError — Unit Tests
// ---------------------------------------------------------------------------

describe('ArtifactValidationError', () => {
	it('sets name and code correctly', () => {
		const error = new ArtifactValidationError('test', 'INVALID_EXTENSION');
		expect(error.name).toBe('ArtifactValidationError');
		expect(error.code).toBe('INVALID_EXTENSION');
		expect(error.message).toBe('test');
	});

	it('is an instance of Error', () => {
		const error = new ArtifactValidationError('test', 'EMPTY_FILE');
		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(ArtifactValidationError);
	});

	it('has all error codes', () => {
		const codes = ['INVALID_EXTENSION', 'FILE_TOO_LARGE', 'EMPTY_FILE', 'MISSING_FILE'] as const;

		for (const code of codes) {
			const error = new ArtifactValidationError('msg', code);
			expect(error.code).toBe(code);
		}
	});
});

// ---------------------------------------------------------------------------
// Ninbus Artifact Type Constants — Unit Tests
// ---------------------------------------------------------------------------

describe('Ninbus Artifact Type Constants', () => {
	it('has exactly 3 artifact types', () => {
		expect(Object.keys(NINBUS_ARTIFACT_TYPES).length).toBe(3);
	});

	it('has firmware-ninbus type', () => {
		expect(NINBUS_ARTIFACT_TYPES.NINBUS_FIRMWARE).toBe('firmware-ninbus');
	});

	it('has firmware-controller type', () => {
		expect(NINBUS_ARTIFACT_TYPES.CONTROLLER_FIRMWARE).toBe('firmware-controller');
	});

	it('has configuration-nfx type', () => {
		expect(NINBUS_ARTIFACT_TYPES.NFX_CONFIGURATION).toBe('configuration-nfx');
	});

	it('each type has metadata', () => {
		for (const type of Object.values(NINBUS_ARTIFACT_TYPES)) {
			const meta = NINBUS_ARTIFACT_TYPE_META[type];
			expect(meta).toBeDefined();
			expect(meta.label).toBeDefined();
			expect(meta.description).toBeDefined();
			expect(meta.target).toBeDefined();
			expect(typeof meta.requiresReboot).toBe('boolean');
			expect(['low', 'medium', 'high']).toContain(meta.riskLevel);
		}
	});
});
