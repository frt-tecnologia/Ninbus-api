import { hawkbitConfig } from '@common/config/hawkbit';
import { db } from '@common/db';
import { devices } from '@common/db/schema';
import { logActivity } from '@modules/observability/activity-service';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { FirmwareValidationError } from './service';
import { triggerFirmwareUpdate } from './status-service';

/**
 * Admin-forced update — POST /api/admin/firmware/deploy (super admin).
 *
 * The console counterpart of the mobile trigger: the admin picks devices
 * (possibly across companies) and the factory pushes the update without any
 * end-user interaction. hawkBit deployments are download/update FORCED, so
 * devices install on their next DDI poll regardless of who triggered.
 *
 * Devices are grouped by company — each company gets its own deployment
 * (isolated Distribution Set, assignment verification and audit), reusing
 * the exact same execution the mobile trigger uses.
 */
export async function deployFirmwareToDevices(
	userId: string,
	deviceIds: string[],
	artifactType: 'firmware-ninbus' | 'firmware-controller' = 'firmware-ninbus',
	releaseId?: string,
) {
	if (!hawkbitConfig.enabled) {
		throw new FirmwareValidationError(
			'Firmware operations require hawkBit to be enabled',
			'HAWKBIT_NOT_ENABLED',
		);
	}

	// Global selection: any claimed, hawkBit-linked device of any company.
	const rows = await db
		.select({ id: devices.id, companyId: devices.companyId })
		.from(devices)
		.where(
			and(
				isNotNull(devices.hawkbitTargetId),
				eq(devices.status, 'accepted'),
				isNotNull(devices.companyId),
				inArray(devices.id, deviceIds),
			),
		);

	if (rows.length === 0) {
		throw new FirmwareValidationError(
			'None of the given devices are eligible for update.',
			'NOT_FOUND',
		);
	}

	const byCompany = new Map<string, string[]>();
	for (const r of rows) {
		const cid = r.companyId as string;
		const list = byCompany.get(cid) ?? [];
		list.push(r.id);
		byCompany.set(cid, list);
	}

	const deployments = [];
	for (const [companyId, ids] of byCompany) {
		deployments.push({
			companyId,
			result: await triggerFirmwareUpdate(companyId, userId, ids, artifactType, { releaseId }),
		});
	}
	return { companies: deployments.length, devices: rows.length, deployments };
}

/**
 * Route handler extracted from routes.ts to keep that file under the
 * 250-line limit. Wired as `POST /api/admin/firmware/deploy`.
 *
 * NOTE: the withAuth/superAdmin macros decorate the context at runtime
 * (user, set, body); outside the Elysia chain the inferred context type
 * collapses to an index signature, so the param is typed `any` and narrowed
 * once below. Body shape is still enforced by DeployFirmwareBodySchema.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleAdminForceDeploy(ctx: any) {
	const { body, user, set } = ctx as {
		body: {
			deviceIds: string[];
			artifactType?: 'firmware-ninbus' | 'firmware-controller';
			releaseId?: string;
		};
		user: { id: string; email: string };
		set: { status?: number | undefined };
	};
	try {
		const result = await deployFirmwareToDevices(
			user.id,
			body.deviceIds,
			body?.artifactType ?? 'firmware-ninbus',
			body?.releaseId,
		);
		await logActivity({
			actorUserId: user.id,
			actorEmail: user.email,
			companyId: null,
			action: 'firmware.deploy_forced',
			entityType: 'firmware_release',
			entityId: String(result.deployments[0]?.result.dsId ?? ''),
			entityLabel: `${result.devices} device(s), ${result.companies} company/companies`,
			metadata: { devices: result.devices, companies: result.companies },
		});
		return {
			message: `Forced firmware update queued for ${result.devices} device(s) across ${result.companies} company/companies`,
			data: result,
		};
	} catch (error) {
		if (error instanceof FirmwareValidationError) {
			set.status = error.code === 'NOT_FOUND' ? 404 : 400;
			return {
				error: error.code === 'NOT_FOUND' ? 'Not Found' : 'Validation error',
				message: error.message,
				code: error.code,
			};
		}
		throw error;
	}
}
