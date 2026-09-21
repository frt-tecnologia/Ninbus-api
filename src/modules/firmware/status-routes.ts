import { withAuth } from '@common/middleware/auth-guard';
import {
	ErrorResponseSchema,
	FirmwareStatusResponseSchema,
	TriggerFirmwareUpdateSchema,
} from '@modules/firmware/schemas';
import { Elysia, t } from 'elysia';
import { triggerFirmwareUpdate } from './deploy-trigger';
import { FirmwareValidationError, firmwareErrorResponse } from './errors';
import { getCompanyFirmwareStatus } from './status-service';

/**
 * Company-scoped firmware routes — what the mobile app consumes.
 *
 * - GET  /api/companies/:companyId/devices/firmware/status → viewer
 *   Which devices are up to date / outdated / unknown / error vs the latest
 *   factory release. The mobile shows this and, when the client approves,
 *   triggers the update for the outdated subset.
 *
 * - POST /api/companies/:companyId/devices/firmware/update → operator
 *   Deploys the latest factory release to the given devices.
 */
export const firmwareStatusRoutes = withAuth(
	new Elysia({ prefix: '/api/companies/:companyId/devices/firmware' }),
)
	.get(
		'/status',
		async ({ params }) => {
			return getCompanyFirmwareStatus(params.companyId);
		},
		{
			auth: true,
			companyRole: 'viewer',
			params: t.Object({ companyId: t.String({ format: 'uuid' }) }),
			detail: {
				tags: ['Firmware'],
				summary: 'Firmware status of the company devices',
				description:
					'Compares every accepted device\u2019s reported firmware version (DDI attributes, ' +
					'synced into devices.firmwareVersion) against the latest factory release. ' +
					'DB-only — no hawkBit calls. The response carries the devices the mobile may ' +
					'update (firmwareStatus="update_available") plus the target release metadata.',
			},
			response: {
				200: FirmwareStatusResponseSchema,
				403: ErrorResponseSchema,
			},
		},
	)
	.post(
		'/update',
		async ({ params, body, user, set }) => {
			try {
				const result = await triggerFirmwareUpdate(params.companyId, user.id, body.deviceIds);
				return {
					message: `Firmware update queued for ${result.targetsAssigned} device(s)`,
					data: result,
				};
			} catch (error) {
				if (error instanceof FirmwareValidationError) {
					const r = firmwareErrorResponse(error);
					set.status = r.status;
					return r.body;
				}
				throw error;
			}
		},
		{
			auth: true,
			companyRole: 'operator',
			params: t.Object({ companyId: t.String({ format: 'uuid' }) }),
			body: TriggerFirmwareUpdateSchema,
			detail: {
				tags: ['Firmware'],
				summary: 'Trigger a firmware update for selected devices',
				description:
					'Creates a deployment of the LATEST factory firmware release to the given devices. ' +
					'Only devices of this company (claimed + hawkBit-linked) are affected; others are ' +
					'dropped. Requires operator role or above — call after the client approves the update.',
			},
			response: {
				200: t.Object({
					message: t.String(),
					data: t.Object({
						dsId: t.Number(),
						name: t.String(),
						version: t.String(),
						targetsAssigned: t.Number(),
						artifactType: t.String(),
						smId: t.Number(),
						smName: t.String(),
						verified: t.Number(),
						failed: t.Number(),
					}),
				}),
				400: ErrorResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
				503: ErrorResponseSchema,
			},
		},
	);
