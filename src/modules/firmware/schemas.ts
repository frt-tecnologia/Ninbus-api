import { dateTimeString } from '@common/schemas';
import { t } from 'elysia';

/**
 * Firmware module schemas — factory-managed global firmware catalog.
 *
 * All response schemas live here; route files import them (never inline).
 */

/** Rejects ASCII control chars (0x00–0x1F) and DEL (0x7F) — same as artifacts. */
const NO_CONTROL_CHARS = '^[^\\x00-\\x1F\\x7F]*$';

/**
 * Semantic version tag — MAJOR.MINOR.PATCH with optional pre-release/build
 * suffix. This is the "tag da atualização" the factory must provide on every
 * upload (e.g. "4.0.1", "4.1.0-rc.2").
 */
export const SEMVER_PATTERN = '^\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?$';

/** Factory firmware upload — version tag is REQUIRED (unlike company artifacts). */
export const UploadFirmwareBodySchema = t.Object(
	{
		file: t.File({
			description:
				'Raw firmware file (.fir, .frz, .bin). Max size: ARTIFACT_MAX_SIZE_MB (default 50 MB). ' +
				'Packaged server-side into the device .tar contract (header-info + data/payload.bin).',
		}),
		name: t.String({
			minLength: 1,
			maxLength: 256,
			pattern: NO_CONTROL_CHARS,
			description: 'Display name (e.g. "wifi3 — estabilidade CAN")',
		}),
		version: t.String({
			pattern: SEMVER_PATTERN,
			maxLength: 64,
			description: 'Semantic version tag of this release (REQUIRED, e.g. "4.0.1")',
		}),
		artifactType: t.Union(
			[
				t.Literal('firmware-ninbus', { description: 'Ninbus self-update (STM32, reboots)' }),
				t.Literal('firmware-controller', { description: 'Controller/LightDot firmware via CAN' }),
			],
			{ description: 'Firmware type — which component this release updates' },
		),
		description: t.Optional(t.String({ maxLength: 1000, description: 'Optional release notes' })),
	},
	{
		default: {
			name: 'wifi3 — estabilidade CAN',
			version: '4.0.1',
			artifactType: 'firmware-ninbus',
			description: 'Correção de reconexão WiFi + watchdog CAN.',
		},
	},
);

/** A firmware release as stored in the local catalog (DB-only read). */
export const FirmwareReleaseSchema = t.Object({
	id: t.String({ format: 'uuid' }),
	name: t.String(),
	version: t.String({ description: 'Semantic version tag (e.g. "4.0.1")' }),
	artifactType: t.String(),
	description: t.Union([t.String(), t.Null()]),
	originalFilename: t.Union([t.String(), t.Null()]),
	payloadSize: t.Union([t.Number(), t.Null()]),
	packageSize: t.Union([t.Number(), t.Null()]),
	createdBy: t.Union([t.String(), t.Null()]),
	createdAt: dateTimeString,
	updatedAt: dateTimeString,
});

export const FirmwareReleaseListResponseSchema = t.Object({
	data: t.Array(FirmwareReleaseSchema),
	total: t.Number(),
});

export const FirmwareLatestResponseSchema = t.Object({
	data: t.Union([FirmwareReleaseSchema, t.Null()], {
		description: 'Latest release for the requested type, null if none published yet',
	}),
});

export const FirmwareUploadResponseSchema = t.Object({
	message: t.String(),
	data: t.Optional(
		t.Object({
			releaseId: t.String({ format: 'uuid' }),
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

// ── Company-scoped firmware status (mobile) ─────────────────────────

/** Per-device firmware status vs the latest factory release. */
export const DeviceFirmwareStatusSchema = t.Object({
	deviceId: t.String({ format: 'uuid' }),
	name: t.String(),
	serialDisplay: t.Union([t.String(), t.Null()]),
	controllerId: t.Union([t.String(), t.Null()]),
	/** Firmware version the device reported via DDI (null = never reported). */
	firmwareVersion: t.Union([t.String(), t.Null()]),
	/** Controller (peripheral) firmware version reported via DDI. */
	controllerFirmwareVersion: t.Union([t.String(), t.Null()]),
	connectionStatus: t.Union([t.String(), t.Null()]),
	/** hawkBit update status — 'error' means the last OTA attempt failed. */
	hawkbitUpdateStatus: t.Union([t.String(), t.Null()]),
	/**
	 * up_to_date | update_available | unknown | error | no_release
	 *  - update_available → mobile may trigger the update (POST /update)
	 *  - unknown          → device never reported its version via DDI
	 *  - error            → last deployment failed (hawkbitUpdateStatus=error)
	 */
	firmwareStatus: t.String(),
});

export const FirmwareStatusResponseSchema = t.Object({
	/** Latest published releases per firmware type (null = none published). */
	latest: t.Object({
		ninbus: t.Union([FirmwareReleaseSchema, t.Null()]),
		controller: t.Union([FirmwareReleaseSchema, t.Null()]),
	}),
	devices: t.Array(DeviceFirmwareStatusSchema),
	summary: t.Object({
		total: t.Number(),
		upToDate: t.Number(),
		outdated: t.Number(),
		unknown: t.Number(),
		error: t.Number(),
	}),
});

/** POST /devices/firmware/update — trigger the update for selected devices. */
export const TriggerFirmwareUpdateSchema = t.Object(
	{
		deviceIds: t.Array(t.String({ format: 'uuid' }), {
			minItems: 1,
			maxItems: 500,
			description: 'Devices to update (must belong to this company). Cross-tenant ids are dropped.',
		}),
	},
	{
		default: { deviceIds: ['123e4567-e89b-12d3-a456-426614174000'] },
	},
);

// ── Admin-forced deploy (console) ─────────────────────────────────

/** Deployment execution result (shared by mobile trigger and admin force). */
export const FirmwareDeploymentResultSchema = t.Object({
	dsId: t.Number(),
	name: t.String(),
	version: t.String(),
	targetsAssigned: t.Number(),
	artifactType: t.String(),
	smId: t.Number(),
	smName: t.String(),
	verified: t.Number(),
	failed: t.Number(),
});

/** POST /api/admin/firmware/deploy — admin body (global device selection). */
export const DeployFirmwareBodySchema = t.Object(
	{
		deviceIds: t.Array(t.String({ format: 'uuid' }), {
			minItems: 1,
			maxItems: 500,
			description: 'Devices to update (any company; grouped into per-company deployments).',
		}),
		// Firmware type to deploy — defaults to firmware-ninbus.
		artifactType: t.Optional(t.Union([t.Literal('firmware-ninbus'), t.Literal('firmware-controller')])),
	},
	{
		default: { deviceIds: ['123e4567-e89b-12d3-a456-426614174000'] },
	},
);

export const FirmwareDeployResponseSchema = t.Object({
	message: t.String(),
	data: t.Object({
		companies: t.Number({ description: 'Deployments created (one per company).' }),
		devices: t.Number({ description: 'Total devices scheduled.' }),
		deployments: t.Array(
			t.Object({
				companyId: t.String({ format: 'uuid' }),
				result: FirmwareDeploymentResultSchema,
			}),
		),
	}),
});

export { ErrorResponseSchema, GenericActionResponseSchema } from '@common/schemas';
