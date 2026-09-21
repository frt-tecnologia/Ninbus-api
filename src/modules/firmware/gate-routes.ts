import { withAuth } from '@common/middleware/auth-guard';
import { setFirmwareReleaseStatus } from '@modules/firmware/release-gate';
import { ErrorResponseSchema, FirmwarePublishResponseSchema } from '@modules/firmware/schemas';
import { FirmwareValidationError } from '@modules/firmware/service';
import { logActivity } from '@modules/observability/activity-service';
import { Elysia, t } from 'elysia';

/**
 * Firmware Publish Gate Routes — draft ⇄ published lifecycle.
 *
 * Extracted from routes.ts to keep it under the 250-line limit. Same prefix
 * as the catalog routes; registered together in app.ts.
 */
export const firmwareGateRoutes = withAuth(new Elysia({ prefix: '/api/admin/firmware' }))
	// POST /:releaseId/publish — make the release available to end users
	.post(
		'/:releaseId/publish',
		async ({ params, user, set }) => {
			try {
				const release = await setFirmwareReleaseStatus(params.releaseId, 'published');
				await logActivity({
					actorUserId: user.id,
					actorEmail: user.email,
					companyId: null,
					action: 'firmware.published',
					entityType: 'firmware_release',
					entityId: release.id,
					entityLabel: `${release.name} v${release.version}`,
					metadata: { status: release.status },
				});
				return {
					message: `Release ${release.version} is now available for download`,
					data: release,
				};
			} catch (error) {
				if (error instanceof FirmwareValidationError) {
					set.status =
						error.code === 'NOT_FOUND' ? 404 : error.code === 'GATE_FAILED' ? 409 : 400;
					return {
						error:
							error.code === 'NOT_FOUND'
								? 'Not Found'
								: error.code === 'GATE_FAILED'
									? 'Conflict'
									: 'Validation error',
						message: error.message,
						code: error.code,
					};
				}
				throw error;
			}
		},
		{
			auth: true,
			superAdmin: true,
			params: t.Object({ releaseId: t.String({ format: 'uuid' }) }),
			detail: {
				tags: ['Firmware'],
				summary: 'Publish a release — make it available to end users',
				description:
					'Flip a draft release to published. From this moment the mobile status ' +
					'endpoint resolves it as the latest version (update_available) and the ' +
					'opt-in trigger can apply it.',
			},
			response: {
				200: FirmwarePublishResponseSchema,
				400: ErrorResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	)

	// POST /:releaseId/unpublish — emergency brake: hide from end users
	.post(
		'/:releaseId/unpublish',
		async ({ params, user, set }) => {
			try {
				const release = await setFirmwareReleaseStatus(params.releaseId, 'draft');
				await logActivity({
					actorUserId: user.id,
					actorEmail: user.email,
					companyId: null,
					action: 'firmware.unpublished',
					entityType: 'firmware_release',
					entityId: release.id,
					entityLabel: `${release.name} v${release.version}`,
					metadata: { status: release.status },
				});
				return {
					message: `Release ${release.version} is no longer available for download`,
					data: release,
				};
			} catch (error) {
				if (error instanceof FirmwareValidationError) {
					set.status =
						error.code === 'NOT_FOUND' ? 404 : error.code === 'GATE_FAILED' ? 409 : 400;
					return {
						error:
							error.code === 'NOT_FOUND'
								? 'Not Found'
								: error.code === 'GATE_FAILED'
									? 'Conflict'
									: 'Validation error',
						message: error.message,
						code: error.code,
					};
				}
				throw error;
			}
		},
		{
			auth: true,
			superAdmin: true,
			params: t.Object({ releaseId: t.String({ format: 'uuid' }) }),
			detail: {
				tags: ['Firmware'],
				summary: 'Unpublish a release — hide it from end users (emergency brake)',
				description:
					'Flip a published release back to draft. It disappears from user-facing ' +
					'endpoints; deployments already assigned to devices keep running on hawkBit.',
			},
			response: {
				200: FirmwarePublishResponseSchema,
				400: ErrorResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
		},
	);
