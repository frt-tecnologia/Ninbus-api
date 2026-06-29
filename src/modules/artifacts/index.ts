import { NINBUS_ARTIFACT_TYPE_META } from '@common/hawkbit/client';
import { withAuth } from '@common/middleware/auth-guard';
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
 * Role requirements:
 * - POST /        → operator (upload artifact — write operation)
 * - GET /types    → viewer (read-only reference data)
 */
export const artifactsModule = withAuth(
	new Elysia({ prefix: '/api/companies/:companyId/artifacts' }),
)
	// POST / — Upload firmware artifact to hawkBit
	.post(
		'/',
		async ({ params, body, user, set }: any) => {
			const artifactFile = body?.file;
			if (!artifactFile || !(artifactFile instanceof File)) {
				set.status = 400;
				return { error: 'Bad Request', message: 'Firmware file is required' };
			}
			if (!body?.artifactName) {
				set.status = 400;
				return { error: 'Bad Request', message: 'artifactName is required' };
			}
			if (!body?.artifactType) {
				set.status = 400;
				return { error: 'Bad Request', message: 'artifactType is required' };
			}
			try {
				const result = await uploadArtifact(
					params.companyId,
					user.id,
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
					return {
						error: 'Validation error',
						message: error.message,
						code: error.code,
					};
				}
				throw error;
			}
		},
		{
			auth: true,
			companyRole: 'operator',
			params: t.Object({ companyId: t.String({ format: 'uuid' }) }),
			body: UploadArtifactBodySchema,
			detail: {
				tags: ['Artifacts'],
				summary: 'Upload firmware artifact to hawkBit',
				description:
					'Uploads a raw firmware file (.fir, .frz, .bin) to hawkBit. The API packages it into a .tar ' +
					'archive for the embedded device. Each upload creates a unique Software Module (UUID-based name). ' +
					'Requires operator role or above.',
			},
			response: {
				201: ArtifactUploadResponseSchema,
				400: ErrorResponseSchema,
				403: ErrorResponseSchema,
				503: ErrorResponseSchema,
			},
		},
	)

	// GET /types — List supported artifact types
	.get(
		'/types',
		async () => {
			return {
				data: Object.entries(NINBUS_ARTIFACT_TYPE_META).map(([type, meta]) => ({
					type,
					...meta,
				})),
			};
		},
		{
			auth: true,
			companyRole: 'viewer',
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
