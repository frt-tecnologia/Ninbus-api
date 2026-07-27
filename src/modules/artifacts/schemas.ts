import { env } from '@common/config/env';
import { dateTimeString } from '@common/schemas';
import { t } from 'elysia';

/**
 * Rejects ASCII control chars (0x00–0x1F) and DEL (0x7F) in display names.
 * Defense-in-depth against log injection, null-byte tricks, and stored-XSS surfaces.
 */
const NO_CONTROL_CHARS = '^[^\\x00-\\x1F\\x7F]*$';

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
 * Max artifact file size in bytes (configurable via ARTIFACT_MAX_SIZE_MB, default 50 MB).
 * Keeps the in-memory tar packager from OOM-killing the container.
 */
export const ARTIFACT_MAX_SIZE_BYTES = env.ARTIFACT_MAX_SIZE_MB * 1024 * 1024;

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
	'.opt',
] as const;

/**
 * Schema for uploading a raw firmware file.
 * The API creates a Software Module + Artifact in hawkBit.
 */
export const UploadArtifactBodySchema = t.Object(
	{
		file: t.File({
			description:
				'Raw firmware file (.fir, .frz, .bin). Max size: ARTIFACT_MAX_SIZE_MB (default 50 MB).',
		}),
		artifactName: t.String({
			minLength: 1,
			maxLength: 256,
			pattern: NO_CONTROL_CHARS,
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

/**
 * PATCH body — partial update of editable artifact metadata (name + description).
 * Only fields present in the body change. The local DB is the canonical source;
 * the hawkBit Software Module description is synced best-effort (non-authoritative).
 */
export const patchArtifactSchema = t.Object(
	{
		name: t.Optional(
			t.String({
				minLength: 1,
				maxLength: 256,
				pattern: NO_CONTROL_CHARS,
				description: 'Display name (etiqueta)',
			}),
		),
		description: t.Optional(
			t.String({
				maxLength: 1000,
				description: 'Free-form description. Send null or "" to clear.',
			}),
		),
	},
	{
		default: { name: 'ninbus-firmware-3.3.1', description: 'Hotfix de estabilidade' },
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
	/** hawkBit returns epoch millis — API converts to ISO date string. */
	createdAt: t.Optional(dateTimeString),
	lastModifiedBy: t.Optional(t.String()),
	/** hawkBit returns epoch millis — API converts to ISO date string. */
	lastModifiedAt: t.Optional(dateTimeString),
	/** Artifact binaries uploaded to this Software Module. */
	artifacts: t.Optional(
		t.Array(
			t.Object({
				id: t.Number(),
				filename: t.Optional(t.String()),
				size: t.Optional(t.Number({ description: 'File size in bytes' })),
				hashes: t.Optional(
					t.Object({
						sha1: t.Optional(t.String()),
						sha256: t.Optional(t.String()),
						md5: t.Optional(t.String()),
					}),
				),
			}),
		),
	),
	/** Total file size in bytes across all artifact binaries. */
	size: t.Optional(t.Number({ description: 'Total artifact file size in bytes' })),
	/** Distribution sets locking this software module, with real deployment status. */
	lockedByDistributionSets: t.Optional(
		t.Array(
			t.Object({
				id: t.Number(),
				name: t.String(),
				status: t.Union([t.Literal('active'), t.Literal('completed')]),
			}),
		),
	),
	/** Whether this artifact can be safely deleted. */
	deletable: t.Optional(t.Boolean({ description: 'Se o artefato pode ser deletado' })),
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
	/** hawkBit returns epoch millis — API converts to ISO date string. */
	createdAt: t.Optional(dateTimeString),
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
			/** Total .tar archive size uploaded to hawkBit. */
			size: t.Number(),
			/** Original raw firmware file size (before tar packaging). */
			payloadSize: t.Optional(t.Number()),
		}),
	),
});

export const ArtifactDeleteResponseSchema = t.Object({
	message: t.String(),
	cleanedUp: t.Optional(
		t.Array(
			t.Object({
				dsId: t.Number(),
				dsName: t.String(),
			}),
		),
	),
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

// ── Artifact Category (grouping) schemas ─────────────────────────────

/**
 * PATCH body — replace the full set of categories for an artifact (idempotent).
 * Cross-tenant categoryIds are silently dropped. Send [] to clear all groups.
 */
export const assignArtifactCategoriesSchema = t.Object(
	{
		categoryIds: t.Array(t.String({ format: 'uuid' }), {
			maxItems: 200,
			description:
				'Category (group) IDs to assign. Replaces the current set. Cross-tenant ids are dropped.',
		}),
	},
	{ default: { categoryIds: ['123e4567-e89b-12d3-a456-426614174000'] } },
);

export const ArtifactCategoryItemSchema = t.Object({
	id: t.String({ format: 'uuid' }),
	companyId: t.Union([t.String({ format: 'uuid' }), t.Null()]),
	name: t.String(),
	type: t.String(),
	description: t.Union([t.String(), t.Null()]),
	createdAt: dateTimeString,
	updatedAt: dateTimeString,
	assignedAt: dateTimeString,
});

export const ArtifactCategoryListResponseSchema = t.Object({
	data: t.Array(ArtifactCategoryItemSchema),
	total: t.Number(),
});

export const ArtifactCategoryAssignResponseSchema = t.Object({
	message: t.String(),
	assigned: t.Number(),
	dropped: t.Optional(t.Number()),
});
