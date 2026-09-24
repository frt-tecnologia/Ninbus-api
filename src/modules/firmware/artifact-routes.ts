import { HawkbitApiError } from '@common/hawkbit/client';
import { withAuth } from '@common/middleware/auth-guard';
import { downloadServedArtifact } from '@modules/firmware/artifact-download';
import { FirmwareValidationError, firmwareErrorResponse } from '@modules/firmware/errors';
import { ErrorResponseSchema, FirmwareArtifactBinarySchema } from '@modules/firmware/schemas';
import { logActivity } from '@modules/observability/activity-service';
import { Elysia, t } from 'elysia';

/**
 * Firmware Artifact Routes — served-binary download (forensics/audit).
 *
 * Extracted from routes.ts to keep it under the 250-line limit. Same prefix
 * as the catalog routes; registered together in app.ts.
 */
export const firmwareArtifactRoutes = withAuth(new Elysia({ prefix: '/api/admin/firmware' }))
	// GET /:releaseId/artifact — download the binary hawkBit SERVES for a release
	.get(
		'/:releaseId/artifact',
		async ({ params, query, user, set }) => {
			try {
				const artifact = await downloadServedArtifact(params.releaseId, query?.part ?? 'tar');
				await logActivity({
					actorUserId: user.id,
					actorEmail: user.email,
					companyId: null,
					action: 'firmware.artifact_downloaded',
					entityType: 'firmware_release',
					entityId: params.releaseId,
					metadata: { sha256: artifact.sha256, size: artifact.buffer.length },
				});
				return new Response(new Uint8Array(artifact.buffer), {
					headers: {
						'content-type': 'application/octet-stream',
						'content-disposition': `attachment; filename="${artifact.filename}"`,
						'x-artifact-sha256': artifact.sha256,
						'x-artifact-size': String(artifact.buffer.length),
					},
				});
			} catch (error) {
				if (error instanceof FirmwareValidationError) {
					const r = firmwareErrorResponse(error);
					set.status = r.status;
					return r.body;
				}
				if (error instanceof HawkbitApiError) {
					set.status = 502;
					return {
						error: 'Upstream Error',
						message: `hawkBit returned ${error.status} on artifact download`,
					};
				}
				set.status = 503;
				return {
					error: 'Service Unavailable',
					message: 'Failed to download the artifact from hawkBit',
				};
			}
		},
		{
			auth: true,
			superAdmin: true,
			params: t.Object({ releaseId: t.String({ format: 'uuid' }) }),
			query: t.Object({
				part: t.Optional(
					t.Union([t.Literal('tar'), t.Literal('image')], {
						description:
							'tar = the stored package exactly as devices download it; image = the inner payload (.bin) extracted from the tar.',
					}),
				),
			}),
			detail: {
				tags: ['Firmware'],
				summary: 'Download the served artifact binary (factory only)',
				description:
					'Downloads the EXACT binary hawkBit serves to devices for a release — ' +
					'byte-level ground truth to compare against the factory build (incident ' +
					'forensics: INC-673/674/675). ?part=tar → the stored package; ' +
					'?part=image → the inner .bin payload extracted from it. Headers: ' +
					'x-artifact-sha256, x-artifact-size; filename carries version + Software ' +
					'Module id for provenance.',
			},
			response: {
				200: FirmwareArtifactBinarySchema,
				400: ErrorResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
				503: ErrorResponseSchema,
			},
		},
	);
