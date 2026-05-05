import { t } from 'elysia';

/**
 * Artifact type identifiers for Ninbus devices.
 * These map to hawkBit Software Module Types.
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
		version: t.Optional(
			t.String({
				maxLength: 64,
				description: 'Distribution set version (default: derived from artifactName)',
			}),
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
	},
	{
		default: {
			name: 'Atualização de Firmware Q3',
			artifactName: 'ninbus-firmware-v3.1.2',
			artifactType: 'firmware-ninbus',
			allDevices: true,
		},
	},
);

export const abortActionSchema = t.Object(
	{
		force: t.Optional(
			t.Boolean({
				default: true,
				description: 'Force cancel even if action is in progress',
			}),
		),
	},
	{
		default: {
			force: true,
		},
	},
);

// ── hawkBit Distribution Set Schema ──────────────────────────────────

export const DistributionSetSchema = t.Object({
	id: t.Number(),
	name: t.String(),
	version: t.Optional(t.String()),
	type: t.Optional(t.String()),
	typeName: t.Optional(t.String()),
	description: t.Optional(t.String()),
	locked: t.Optional(t.Boolean()),
	complete: t.Optional(t.Boolean()),
	valid: t.Optional(t.Boolean()),
});

// ── hawkBit Action Schema ────────────────────────────────────────────

export const ActionSchema = t.Object({
	id: t.Number(),
	type: t.Optional(t.String()),
	active: t.Optional(t.Boolean()),
	status: t.Optional(t.String()),
	forceType: t.Optional(t.String()),
	weight: t.Optional(t.Number()),
	rollout: t.Optional(t.Number()),
	rolloutName: t.Optional(t.String()),
	lastStatusCode: t.Optional(t.Number()),
});

export const ActionStatusSchema = t.Object({
	id: t.Number(),
	type: t.String(),
	messages: t.Optional(t.Array(t.String())),
	reportedAt: t.Optional(t.Number()),
	code: t.Optional(t.Number()),
});

// ── Response Schemas ─────────────────────────────────────────────────

export const DeploymentResponseSchema = t.Object({
	data: DistributionSetSchema,
});

export const DeploymentListResponseSchema = t.Object({
	data: t.Array(DistributionSetSchema),
	total: t.Number(),
});

export const DeploymentCreateResponseSchema = t.Object({
	message: t.String(),
	data: t.Object({
		dsId: t.Number(),
		name: t.String(),
		version: t.Optional(t.String()),
		targetsAssigned: t.Number(),
		artifactType: t.String(),
	}),
});

export const DeploymentStatisticsResponseSchema = t.Object({
	data: t.Any(),
});

export const DeviceActionsResponseSchema = t.Object({
	data: t.Array(ActionSchema),
	total: t.Optional(t.Number()),
});

export const ActionStatusListResponseSchema = t.Object({
	data: t.Array(ActionStatusSchema),
	total: t.Optional(t.Number()),
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

// ── Params ────────────────────────────────────────────────────────────

export const companyParams = t.Object({ companyId: t.String({ format: 'uuid' }) });
export const deploymentParams = t.Object({
	companyId: t.String({ format: 'uuid' }),
	deploymentId: t.String(),
});
export const deploymentActionParams = t.Object({
	companyId: t.String({ format: 'uuid' }),
	targetId: t.String(),
	actionId: t.String(),
});
