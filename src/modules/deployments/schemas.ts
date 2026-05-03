import { t } from 'elysia';

/**
 * Artifact type identifiers for Ninbus devices.
 * These MUST match the Mender artifact header type field exactly.
 *
 * | Type                     | Destination                    | Risk  | Reboot |
 * |--------------------------|--------------------------------|-------|--------|
 * | firmware-ninbus          | NAND → Bootloader → STM32F407  | HIGH  | YES    |
 * | firmware-controller      | CAN → LightDot                 | MED   | NO     |
 * | configuration-nfx        | NAND NFX → CAN → LightDot      | LOW   | NO     |
 */
export const ARTIFACT_TYPE_NINBUS_FIRMWARE = 'firmware-ninbus';
export const ARTIFACT_TYPE_CONTROLLER_FIRMWARE = 'firmware-controller';
export const ARTIFACT_TYPE_NFX_CONFIGURATION = 'configuration-nfx';

export const NINBUS_ARTIFACT_TYPE_VALUES = [
	ARTIFACT_TYPE_NINBUS_FIRMWARE,
	ARTIFACT_TYPE_CONTROLLER_FIRMWARE,
	ARTIFACT_TYPE_NFX_CONFIGURATION,
] as const;

export const createOtaDeploymentSchema = t.Object(
	{
		name: t.String({ minLength: 1, maxLength: 255, description: 'Deployment name' }),
		artifactName: t.String({
			minLength: 1,
			description: 'Artifact name to deploy (e.g. ninbus-firmware-3.3.0)',
		}),
		/** Artifact type — determines the update destination on the device */
		artifactType: t.Union(
			[
				t.Literal(ARTIFACT_TYPE_NINBUS_FIRMWARE, {
					description: 'Firmware Ninbus (STM32F407) → NAND → Bootloader → Reboot',
				}),
				t.Literal(ARTIFACT_TYPE_CONTROLLER_FIRMWARE, {
					description: 'Firmware Controlador LightDot → CAN Bus',
				}),
				t.Literal(ARTIFACT_TYPE_NFX_CONFIGURATION, {
					description: 'Configuração NFX/FRZ → NAND NFX → CAN → LightDot',
				}),
			],
			{
				description:
					'Type of artifact being deployed. Determines the update path on the embedded device.',
			},
		),
		deviceIds: t.Optional(
			t.Array(t.String({ format: 'uuid' }), {
				description: 'Specific Ninbus device IDs to deploy to',
			}),
		),
		categoryIds: t.Optional(
			t.Array(t.String({ format: 'uuid' }), {
				description: 'Deploy to all devices in these categories',
			}),
		),
		allDevices: t.Optional(
			t.Boolean({
				description: 'Deploy to all accepted devices in the company',
			}),
		),
		retries: t.Optional(
			t.Number({ minimum: 0, maximum: 10, description: 'Retry count on failure' }),
		),
	},
	{
		default: {
			name: 'Atualização de Firmware Q3',
			artifactName: 'ninbus-firmware-v3.1.2',
			artifactType: 'firmware-ninbus',
			allDevices: true,
			retries: 3,
		},
	},
);

export const abortDeploymentSchema = t.Object(
	{
		status: t.Literal('aborted', { description: 'Must be "aborted"' }),
	},
	{
		default: {
			status: 'aborted',
		},
	},
);

export const DeploymentSchema = t.Object({
	id: t.String(),
	name: t.String(),
	artifact_name: t.String(),
	created: t.String(),
	finished: t.Optional(t.String()),
	status: t.String(),
	device_count: t.Optional(t.Number()),
	phases: t.Optional(t.Array(t.Any())),
});

export const DeploymentStatisticsSchema = t.Object({
	success: t.Number(),
	pending: t.Number(),
	failure: t.Number(),
	downloading: t.Number(),
	installing: t.Number(),
	rebooting: t.Number(),
	noartifact: t.Number(),
	alreadyinst: t.Number(),
	aborted: t.Number(),
});

export const DeviceDeploymentSchema = t.Object({
	id: t.String(),
	device_id: t.String(),
	deployment_id: t.String(),
	status: t.String(),
	created: t.String(),
	finished: t.Optional(t.String()),
	log: t.Optional(t.Boolean()),
});

export const DeviceDeploymentLogSchema = t.Object({
	messages: t.Array(
		t.Object({
			time: t.String(),
			level: t.String(),
			message: t.String(),
		}),
	),
});

export const DeploymentResponseSchema = t.Object({
	data: DeploymentSchema,
});

export const DeploymentListResponseSchema = t.Object({
	data: t.Array(DeploymentSchema),
	total: t.Number(),
});

export const DeploymentCreateResponseSchema = t.Object({
	message: t.String(),
	data: DeploymentSchema,
});

export const DeploymentStatisticsResponseSchema = t.Object({
	data: DeploymentStatisticsSchema,
});

export const DeviceDeploymentListResponseSchema = t.Object({
	data: t.Array(DeviceDeploymentSchema),
	total: t.Optional(t.Number()),
});

export const DeviceDeploymentLogResponseSchema = t.Object({
	data: DeviceDeploymentLogSchema,
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

// ── Params (used by device-routes.ts) ────────────────────────────────────

export const companyParams = t.Object({ companyId: t.String({ format: 'uuid' }) });
export const deploymentParams = t.Object({
	companyId: t.String({ format: 'uuid' }),
	deploymentId: t.String(),
});
export const deploymentDeviceLogParams = t.Object({
	companyId: t.String({ format: 'uuid' }),
	deploymentId: t.String(),
	menderDeviceId: t.String(),
});
