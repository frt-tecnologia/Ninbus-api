import { withAuth } from '@common/middleware/auth-guard';
import {
	DeployFirmwareBodySchema,
	ErrorResponseSchema,
	FirmwareDeleteResponseSchema,
	FirmwareDeployResponseSchema,
	FirmwareLatestResponseSchema,
	FirmwareReleaseListResponseSchema,
	FirmwareUploadResponseSchema,
	UploadFirmwareBodySchema,
} from '@modules/firmware/schemas';
import { logActivity } from '@modules/observability/activity-service';
import { Elysia, t } from 'elysia';
import { handleAdminForceDeploy } from './force-deploy';
import { deleteFirmwareRelease, listFirmwareReleases, uploadFirmwareRelease } from './service';
import { FirmwareValidationError } from './service';

/**
 * Firmware Admin Routes — factory-only firmware catalog.
 *
 * ALL routes require `superAdmin: true` (email in SUPER_ADMIN_EMAILS):
 * only the factory may publish, view, or remove firmware releases.
 *
 * - POST /        → upload a firmware release (version tag REQUIRED)
 * - GET /         → list releases chronologically (DB-only, works w/o hawkBit)
 * - GET /latest   → latest release per type (highest semver)
 * - DELETE /:id   → remove a release (409 while locked by a deployment)
 * - POST /deploy  → FORCE the update to selected devices (console path)
 */
export const firmwareAdminRoutes = withAuth(new Elysia({ prefix: '/api/admin/firmware' }))
	// POST / — Upload a factory firmware release
	.post(
		'/',
		async ({ body, user, set }: any) => {
			const file = body?.file;
			if (!file || !(file instanceof File)) {
				set.status = 400;
				return { error: 'Bad Request', message: 'Firmware file is required' };
			}
			try {
				const result = await uploadFirmwareRelease(user.id, file as File, {
					name: body.name,
					version: body.version,
					artifactType: body.artifactType,
					description: body?.description,
				});
				set.status = 201;
				await logActivity({
					actorUserId: user.id,
					actorEmail: user.email,
					companyId: null,
					action: 'firmware.published',
					entityType: 'firmware_release',
					entityId: result.releaseId,
					entityLabel: `${body.name} v${body.version}`,
					metadata: {
						artifactType: body.artifactType,
						version: body.version,
						filename: file?.name ?? null,
						size: file?.size ?? null,
					},
				});
				return { message: 'Firmware release published successfully', data: result };
			} catch (error) {
				if (error instanceof FirmwareValidationError) {
					set.status = error.code === 'DUPLICATE_VERSION' ? 409 : 400;
					return {
						error: error.code === 'DUPLICATE_VERSION' ? 'Conflict' : 'Validation error',
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
			body: UploadFirmwareBodySchema,
			detail: {
				tags: ['Firmware'],
				summary: 'Publish a firmware release (factory only)',
				description:
					'Uploads a firmware release to the GLOBAL factory catalog. GOLDEN RULE: the device ' +
					'only accepts the canonical v4 TAR (artifact.info + data/firmware.npm with the signed ' +
					'NPM manifest — tools/ota_sign.py + ota_pack.py, repo Ninbus-v4). For firmware-ninbus ' +
					'the .tar is REQUIRED and stored verbatim (the server never signs); raw .bin/.hex/.elf ' +
					'are rejected. firmware-controller also accepts a raw .fir (packaged into the canonical ' +
					'tar server-side). The version tag (semver, e.g. "4.0.1") is REQUIRED and unique per ' +
					'firmware type. Only platform super admins (factory) may publish.',
			},
			response: {
				201: FirmwareUploadResponseSchema,
				400: ErrorResponseSchema,
				403: ErrorResponseSchema,
				409: ErrorResponseSchema,
				503: ErrorResponseSchema,
			},
		},
	)

	// GET / — List firmware releases (chronological, newest first)
	.get(
		'/',
		async ({ query }) => {
			return listFirmwareReleases({ type: query?.type });
		},
		{
			auth: true,
			superAdmin: true,
			query: t.Object({
				type: t.Optional(t.Union([t.Literal('firmware-ninbus'), t.Literal('firmware-controller')])),
			}),
			detail: {
				tags: ['Firmware'],
				summary: 'List firmware releases (factory only)',
				description:
					'Lists ALL firmware releases from the factory catalog, newest first. ' +
					'Reads from the local DB only — no hawkBit dependency.',
			},
			response: { 200: FirmwareReleaseListResponseSchema, 403: ErrorResponseSchema },
		},
	)

	// GET /latest — Latest release per firmware type
	.get(
		'/latest',
		async ({ query }) => {
			const { getLatestRelease } = await import('./service');
			const type = query?.type ?? 'firmware-ninbus';
			return { data: await getLatestRelease(type) };
		},
		{
			auth: true,
			superAdmin: true,
			query: t.Object({
				type: t.Optional(t.Union([t.Literal('firmware-ninbus'), t.Literal('firmware-controller')])),
			}),
			detail: {
				tags: ['Firmware'],
				summary: 'Get the latest firmware release (factory only)',
				description:
					'Returns the release with the highest semver version tag for the given type ' +
					'(null when nothing has been published).',
			},
			response: { 200: FirmwareLatestResponseSchema, 403: ErrorResponseSchema },
		},
	)

	// POST /deploy — Admin-forced update (console; no end-user interaction)
	.post('/deploy', handleAdminForceDeploy, {
		auth: true,
		superAdmin: true,
		body: DeployFirmwareBodySchema,
		detail: {
			tags: ['Firmware'],
			summary: 'Force a firmware update to selected devices (factory console)',
			description:
				'Console counterpart of the mobile trigger: the factory pushes the LATEST release ' +
				'to the given devices without end-user interaction. Devices are grouped by company ' +
				'(one deployment per company). hawkBit deployments are download/update FORCED — ' +
				'devices install on their next DDI poll.',
		},
		response: {
			200: FirmwareDeployResponseSchema,
			400: ErrorResponseSchema,
			403: ErrorResponseSchema,
			404: ErrorResponseSchema,
			503: ErrorResponseSchema,
		},
	})

	// DELETE /:releaseId — Remove a release
	.delete(
		'/:releaseId',
		async ({ params, query, user, set }) => {
			try {
				const result = await deleteFirmwareRelease(params.releaseId, {
					realignFloor: query?.realignFloor === 'true' || query?.realignFloor === true,
				});
				await logActivity({
					actorUserId: user.id,
					actorEmail: user.email,
					companyId: null,
					action: 'firmware.deleted',
					entityType: 'firmware_release',
					entityId: params.releaseId,
					metadata: { hawkbitKept: result.hawkbitKept },
				});
				return result;
			} catch (error) {
				if (error instanceof FirmwareValidationError) {
					// COUNTER_FLOOR_BURNED → 409: conflicts with the device-side
				// anti-replay floor (bootloader contract), not with the request body.
					const conflict = error.code === 'COUNTER_FLOOR_BURNED';
					set.status = error.code === 'NOT_FOUND' ? 404 : conflict ? 409 : 400;
					return {
						error: error.code === 'NOT_FOUND' ? 'Not Found' : conflict ? 'Conflict' : 'Bad Request',
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
			query: t.Object({
				realignFloor: t.Optional(
					t.String({ description: "'true' — when the release holds the sole served counter, transfer the anti-replay floor to the newest older release before deleting (automated runbook)." }),
				),
			}),
			detail: {
				tags: ['Firmware'],
				summary: 'Delete a firmware release (factory only)',
				description:
					'Removes the release from the catalog. When the Software Module is locked ' +
					'by a Distribution Set (already deployed — audit history), the binary stays ' +
					'on hawkBit and the response warns with hawkbitKept=true.',
			},
			response: {
				200: FirmwareDeleteResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
				503: ErrorResponseSchema,
			},
		},
	);
