import { NINBUS_ARTIFACT_TYPE_META } from '@common/hawkbit/client';
import { withAuth } from '@common/middleware/auth-guard';
import { checkMembership } from '@common/middleware/company-check';
import {
	ArtifactTypeListResponseSchema,
	ArtifactUploadResponseSchema,
	ErrorResponseSchema,
	UploadArtifactBodySchema,
} from '@modules/artifacts/schemas';
import { Elysia, t } from 'elysia';
import { ArtifactValidationError, uploadArtifact } from './service';

/**
 * Artifacts Module — Upload and types.
 *
 * hawkBit artifact flow:
 * 1. Client sends raw firmware file (.fir, .frz, .bin) with artifact name and type
 * 2. Server creates a Software Module in hawkBit with the correct type
 * 3. Server uploads the binary as an Artifact within the Software Module
 * 4. Returns enriched data with Ninbus type metadata
 */
export const artifactsModule = withAuth(
	new Elysia({ prefix: '/api/companies/:companyId/artifacts' }),
)
	// POST / — Upload firmware artifact to hawkBit
	.post(
		'/',
		async ({ params, body, user, set }: any) => {
			const err = await checkMembership(params.companyId, user.id);
			if (err) {
				set.status = err.status;
				return err.body;
			}
			const artifactFile = body?.file;
			if (!artifactFile || !(artifactFile instanceof File)) {
				set.status = 400;
				return { error: 'Bad Request', message: 'Firmware file is required' };
			}
			try {
				const result = await uploadArtifact(
					artifactFile as File,
					body.artifactName,
					body.artifactType,
					body.version,
					body?.description,
				);
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
				summary: 'Upload firmware artifact to hawkBit',
				description:
					'Uploads a raw firmware file (.fir, .frz, .bin) to hawkBit. Creates a Software Module + Artifact.',
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
				data: Object.entries(NINBUS_ARTIFACT_TYPE_META).map(([type, meta]) => ({
					type,
					...meta,
				})),
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
