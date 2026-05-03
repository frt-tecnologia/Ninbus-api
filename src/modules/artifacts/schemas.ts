import { t } from 'elysia';

/**
 * Artifacts module schemas.
 *
 * Validates body input for artifact upload and update endpoints.
 * File validation (size, extension) is done in the service layer.
 */

/**
 * Max artifact file size in bytes (500 MB).
 * Matches Mender Gateway's default limit.
 */
export const ARTIFACT_MAX_SIZE_BYTES = 500 * 1024 * 1024;

/**
 * Allowed file extensions for Mender artifact uploads.
 * The Mender Gateway only accepts `.mender` files.
 */
export const ARTIFACT_ALLOWED_EXTENSIONS = ['.mender'] as const;

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
 * Schema for generating artifact from raw firmware file.
 * Accepts raw .fir/.frz files + artifact type + name.
 */
export const GenerateArtifactBodySchema = t.Object({
	file: t.File({
		description:
			'Raw firmware file (.fir, .frz, .bin). The API generates the .mender artifact internally.',
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
	description: t.Optional(
		t.String({ minLength: 1, maxLength: 1000, description: 'Optional description' }),
	),
});

export const UploadArtifactBodySchema = t.Object(
	{
		artifact: t.File({
			description:
				'Mender artifact file (.mender). Must be the last part of the multipart request. Max: 500 MB.',
		}),
		description: t.Optional(
			t.String({ minLength: 1, maxLength: 1000, description: 'Optional description' }),
		),
	},
	{
		default: {
			description: 'Firmware Update',
		},
	},
);

export const ArtifactUpdateFileSchema = t.Object({
	name: t.String(),
	checksum: t.String(),
	size: t.Number(),
	date: t.Optional(t.String()),
});

export const ArtifactUpdateSchema = t.Object({
	type_info: t.Object({
		type: t.Union([t.String(), t.Null()]),
	}),
	files: t.Optional(t.Array(ArtifactUpdateFileSchema)),
	meta_data: t.Optional(t.Record(t.String(), t.Any())),
});

export const ArtifactSchema = t.Object({
	id: t.String(),
	name: t.String(),
	description: t.Optional(t.String()),
	device_types_compatible: t.Optional(t.Array(t.String())),
	info: t.Optional(
		t.Object({
			format: t.String(),
			version: t.Number(),
		}),
	),
	signed: t.Optional(t.Boolean()),
	updates: t.Optional(t.Array(ArtifactUpdateSchema)),
	artifact_provides: t.Optional(t.Record(t.String(), t.String())),
	artifact_depends: t.Optional(t.Record(t.String(), t.Array(t.String()))),
	clears_artifact_provides: t.Optional(t.Array(t.String())),
	size: t.Optional(t.Number()),
	modified: t.Optional(t.String()),
});

export const ReleaseSchema = t.Object({
	name: t.String(),
	artifacts: t.Array(ArtifactSchema),
	device_types_compatible: t.Array(t.String()),
});

export const ArtifactListResponseSchema = t.Object({
	data: t.Array(ArtifactSchema),
	total: t.Optional(t.Number()),
});

export const ReleaseListResponseSchema = t.Object({
	data: t.Array(ReleaseSchema),
	total: t.Optional(t.Number()),
});

export const ArtifactResponseSchema = t.Object({
	data: ArtifactSchema,
});

export const ArtifactUploadResponseSchema = t.Object({
	message: t.String(),
	data: t.Optional(ArtifactSchema),
});

export const ArtifactDeleteResponseSchema = t.Object({
	message: t.String(),
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

// ── Download & Release Responses ──────────────────────────────────────

export const DownloadLinkResponseSchema = t.Object({
	data: t.String(),
});
