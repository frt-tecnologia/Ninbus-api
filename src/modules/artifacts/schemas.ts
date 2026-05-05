import { t } from 'elysia';

/**
 * Artifacts module schemas.
 *
 * In hawkBit, artifacts are managed as:
 * 1. Software Module (container with type, name, version)
 * 2. Artifact (binary file uploaded to a Software Module)
 *
 * File validation (size, extension) is done in the service layer.
 */

/**
 * Max artifact file size in bytes (500 MB).
 */
export const ARTIFACT_MAX_SIZE_BYTES = 500 * 1024 * 1024;

/**
 * Allowed file extensions for raw firmware upload.
 * hawkBit accepts any binary — the API wraps it in a Software Module.
 */
export const ARTIFACT_ALLOWED_EXTENSIONS = [
	'.fir',
	'.frz',
	'.nfx',
	'.bin',
	'.hex',
	'.fw',
	'.cfg',
	'.conf',
] as const;

/**
 * Schema for uploading a raw firmware file.
 * The API creates a Software Module + Artifact in hawkBit.
 */
export const UploadArtifactBodySchema = t.Object(
	{
		file: t.File({
			description: 'Raw firmware file (.fir, .frz, .bin). Max: 500 MB.',
		}),
		artifactName: t.String({
			minLength: 1,
			maxLength: 256,
			description: 'Unique artifact name (e.g., "ninbus-firmware-3.3.0")',
		}),
		artifactType: t.Union(
			[
				t.Literal('firmware-ninbus'),
				t.Literal('firmware-controller'),
				t.Literal('configuration-nfx'),
			],
			{ description: 'Artifact type — determines what action the device takes' },
		),
		version: t.Optional(
			t.String({
				maxLength: 64,
				description: 'Software module version (default: "1.0")',
			}),
		),
		description: t.Optional(
			t.String({ minLength: 1, maxLength: 1000, description: 'Optional description' }),
		),
	},
	{
		default: {
			artifactName: 'ninbus-firmware-3.3.0',
			artifactType: 'firmware-ninbus',
			description: 'Firmware Update',
		},
	},
);

/**
 * Schema for updating artifact metadata.
 */
export const updateArtifactSchema = t.Object(
	{
		description: t.String({
			minLength: 1,
			maxLength: 1000,
			description: 'Updated artifact description',
		}),
	},
	{
		default: {
			description: 'Nova descrição para este artefato de firmware.',
		},
	},
);

// ── hawkBit Software Module Schema ───────────────────────────────────

export const SoftwareModuleSchema = t.Object({
	id: t.Number(),
	name: t.String(),
	version: t.String(),
	type: t.String(),
	typeName: t.Optional(t.String()),
	description: t.Optional(t.String()),
	vendor: t.Optional(t.String()),
	locked: t.Optional(t.Boolean()),
	deleted: t.Optional(t.Boolean()),
	complete: t.Optional(t.Boolean()),
	createdBy: t.Optional(t.String()),
	createdAt: t.Optional(t.Number()),
	lastModifiedBy: t.Optional(t.String()),
	lastModifiedAt: t.Optional(t.Number()),
});

export const ArtifactMetadataSchema = t.Object({
	id: t.Number(),
	providedFilename: t.Optional(t.String()),
	size: t.Optional(t.Number()),
	hashes: t.Optional(
		t.Object({
			sha1: t.Optional(t.String()),
			sha256: t.Optional(t.String()),
			md5: t.Optional(t.String()),
		}),
	),
	createdBy: t.Optional(t.String()),
	createdAt: t.Optional(t.Number()),
});

// ── Response Schemas ─────────────────────────────────────────────────

export const ArtifactListResponseSchema = t.Object({
	data: t.Array(SoftwareModuleSchema),
	total: t.Number(),
});

export const ArtifactResponseSchema = t.Object({
	data: SoftwareModuleSchema,
});

export const ArtifactUploadResponseSchema = t.Object({
	message: t.String(),
	data: t.Optional(
		t.Object({
			smId: t.Number(),
			artifactId: t.Optional(t.Number()),
			name: t.String(),
			version: t.String(),
			type: t.String(),
			size: t.Number(),
		}),
	),
});

export const ArtifactDeleteResponseSchema = t.Object({
	message: t.String(),
});

export const DownloadArtifactResponseSchema = t.Object({
	data: t.Object({
		smId: t.Number(),
		artifactId: t.Number(),
		filename: t.Optional(t.String()),
		size: t.Optional(t.Number()),
		downloadUrl: t.String(),
	}),
});

// Shared generic schemas
export { ErrorResponseSchema, GenericActionResponseSchema } from '@common/schemas';

// ── Artifact Type Response ────────────────────────────────────────────

export const ArtifactTypeItemSchema = t.Object({
	type: t.String(),
	label: t.String(),
	description: t.String(),
	target: t.String(),
	requiresReboot: t.Boolean(),
	riskLevel: t.String(),
});

export const ArtifactTypeListResponseSchema = t.Object({
	data: t.Array(ArtifactTypeItemSchema),
});
