import { NINBUS_ARTIFACT_TYPE_META } from '@common/mender/client';
import { withAuth } from '@common/middleware/auth-guard';
import { checkMembership } from '@common/middleware/company-check';
import {
	ArtifactTypeListResponseSchema,
	ArtifactUploadResponseSchema,
	ErrorResponseSchema,
	GenerateArtifactBodySchema,
	UploadArtifactBodySchema,
} from '@modules/artifacts/schemas';
import { Elysia, t } from 'elysia';
import { ArtifactValidationError, generateAndUploadArtifact, uploadArtifact } from './service';

/**
 * Artifacts Module — Upload and types.
 *
 * Upload flow:
 * 1. Client sends multipart/form-data with `.mender` file + optional description
 * 2. Server validates file extension and size
 * 3. Server proxies the file to Mender Gateway's artifact upload API
 * 4. Mender parses the artifact, validates structure, and indexes it
 * 5. Server returns enriched artifact data with Ninbus type metadata
 */
export const artifactsModule = withAuth(
	new Elysia({ prefix: '/api/companies/:companyId/artifacts' }),
)
	// POST / — Upload Mender artifact
	.post(
		'/',
		async ({ params, body, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			const artifactFile = body?.artifact;
			if (!artifactFile || !(artifactFile instanceof File)) {
				set.status = 400;
				return { error: 'Bad Request', message: 'Artifact file is required' };
			}
			try {
				const result = await uploadArtifact(artifactFile as File, body?.description);
				set.status = 201;
				return { message: 'Artifact uploaded successfully', data: result };
			} catch (error) {
				if (error instanceof ArtifactValidationError) {
					set.status = 400;
					return { error: 'Validation error', message: error.message, code: error.code };
				}
				throw error;
			}
		},
		{
			auth: true,
			params: t.Object({ companyId: t.String({ format: 'uuid' }) }),
			body: UploadArtifactBodySchema,
			detail: {
				tags: ['Artifacts'],
				summary: 'Upload Mender artifact',
				description:
					'Uploads a .mender artifact file to Mender Gateway. Supports artifact versions v1, v2, v3.',
			},
			response: {
				201: ArtifactUploadResponseSchema,
				400: ErrorResponseSchema,
				403: ErrorResponseSchema,
				413: ErrorResponseSchema,
				415: ErrorResponseSchema,
				422: ErrorResponseSchema,
			},
		},
	)

	// POST /generate — Generate .mender artifact from raw firmware file
	.post(
		'/generate',
		async ({ params, body, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			const rawFile = body?.file;
			if (!rawFile || !(rawFile instanceof File)) {
				set.status = 400;
				return { error: 'Bad Request', message: 'Raw firmware file is required' };
			}
			try {
				const result = await generateAndUploadArtifact(
					rawFile as File,
					body.artifactName,
					body.artifactType,
					body?.description,
				);
				set.status = 201;
				return { message: 'Artifact generated and uploaded successfully', data: result };
			} catch (error) {
				if (error instanceof ArtifactValidationError) {
					set.status = 400;
					return { error: 'Validation error', message: error.message, code: error.code };
				}
				throw error;
			}
		},
		{
			auth: true,
			params: t.Object({ companyId: t.String({ format: 'uuid' }) }),
			body: GenerateArtifactBodySchema,
			detail: {
				tags: ['Artifacts'],
				summary: 'Generate .mender artifact from raw firmware',
				description:
					'Accepts a raw firmware file (.fir, .frz, .bin) and generates a .mender artifact with the specified type. ' +
					'The type determines what action the embedded device takes:\n' +
					'- firmware-ninbus → NAND flash → reboot (HIGH risk)\n' +
					'- firmware-controller → CAN bus → LightDot (MEDIUM risk)\n' +
					'- configuration-nfx → NAND NFX → CAN → LightDot config (LOW risk)',
			},
			response: {
				201: ArtifactUploadResponseSchema,
				400: ErrorResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	)

	// GET /types — List supported artifact types
	.get(
		'/types',
		async ({ params, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			return {
				data: Object.entries(NINBUS_ARTIFACT_TYPE_META).map(([type, meta]) => ({ type, ...meta })),
			};
		},
		{
			auth: true,
			params: t.Object({ companyId: t.String({ format: 'uuid' }) }),
			detail: {
				tags: ['Artifacts'],
				summary: 'List artifact types',
				description: 'All Ninbus artifact types with risk levels and destinations',
			},
			response: {
				200: ArtifactTypeListResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	);
