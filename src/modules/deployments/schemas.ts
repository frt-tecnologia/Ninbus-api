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

export const createOtaDeploymentSchema = t.Object({
	name: t.String({ minLength: 1, maxLength: 255 }),
	artifactName: t.String({ minLength: 1, description: 'Artifact name or numeric SM ID' }),
	artifactType: t.Union(
		[
			t.Literal(ARTIFACT_TYPE_NINBUS_FIRMWARE, { description: 'STM32F407 → NAND → Reboot' }),
			t.Literal(ARTIFACT_TYPE_CONTROLLER_FIRMWARE, { description: 'LightDot → CAN Bus' }),
			t.Literal(ARTIFACT_TYPE_NFX_CONFIGURATION, { description: 'NFX/FRZ → CAN → LightDot' }),
		],
		{ description: 'Determines the update path on the embedded device.' },
	),
	version: t.Optional(t.String({ maxLength: 64 })),
	deviceIds: t.Optional(t.Array(t.String({ format: 'uuid' }))),
	categoryIds: t.Optional(t.Array(t.String({ format: 'uuid' }))),
	allDevices: t.Optional(t.Boolean()),
}, {
	default: { name: 'Deployment', artifactName: 'sm-1', artifactType: 'firmware-ninbus', allDevices: true },
});

export const abortActionSchema = t.Object({
	force: t.Optional(t.Boolean({ default: true })),
}, { default: { force: true } });

// ── Deployment Status (computed from hawkBit action statistics) ─────

/**
 * Deployment status computed from hawkBit action statistics.
 *
 * Mapping from hawkBit action statuses:
 *   RUNNING, SCHEDULED          → 'pending'
 *   RETRIEVED, DOWNLOAD,
 *   DOWNLOADED                  → 'in_progress'
 *   FINISHED (all targets)      → 'completed'
 *   ERROR, WARNING              → 'failed'
 *   CANCELED, CANCELING         → 'canceled'
 *   (no targets assigned)       → 'no_targets'
 */
export const DEPLOYMENT_STATUS_VALUES = [
	'pending',
	'in_progress',
	'completed',
	'failed',
	'canceled',
	'no_targets',
] as const;
export type DeploymentStatusType = (typeof DEPLOYMENT_STATUS_VALUES)[number];

export const DeploymentStatusSchema = t.Union(
	DEPLOYMENT_STATUS_VALUES.map((s) => t.Literal(s)),
);

export const DeploymentStatisticsSummarySchema = t.Object({
	totalTargets: t.Number(),
	finished: t.Number(),
	failed: t.Number(),
	inProgress: t.Number(),
	pending: t.Number(),
	canceled: t.Number(),
});

export const DSMetadataSchema = t.Object({
	locked: t.Boolean(),
	complete: t.Boolean(),
	valid: t.Boolean(),
});

/** Enriched distribution set with real deployment status. */
export const EnrichedDistributionSetSchema = t.Object({
	id: t.Number(),
	name: t.String(),
	version: t.Optional(t.String()),
	type: t.Optional(t.String()),
	typeName: t.Optional(t.String()),
	description: t.Optional(t.String()),
	createdAt: t.Optional(t.Number()),
	lastModifiedAt: t.Optional(t.Number()),
	status: DeploymentStatusSchema,
	statistics: DeploymentStatisticsSummarySchema,
	dsMetadata: DSMetadataSchema,
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
	data: EnrichedDistributionSetSchema,
});

export const DeploymentListResponseSchema = t.Object({
	data: t.Array(EnrichedDistributionSetSchema),
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
		smId: t.Optional(t.Number()),
	}),
});

export const DeploymentStatisticsResponseSchema = t.Object({
	data: t.Object({
		raw: t.Any({ description: 'Raw hawkBit statistics response' }),
		summary: DeploymentStatisticsSummarySchema,
		status: DeploymentStatusSchema,
	}),
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

// ── Target Status Schemas (enriched with phase + progress) ───────────
// (moved to trail-schemas.ts to keep this file under 250 lines)
export {
	TargetActionStatusSchema,
	TargetDeploymentStatusSchema,
	EnrichedActionStatusEntrySchema,
	TargetStatusTrailDataSchema,
	TargetStatusesResponseSchema,
	TargetStatusTrailResponseSchema,
} from './trail-schemas';

// ── Params ────────────────────────────────────────────────────────────

export const companyParams = t.Object({ companyId: t.String({ format: 'uuid' }) });
export const deploymentParams = t.Object({
	companyId: t.String({ format: 'uuid' }),
	deploymentId: t.String(),
});
export const deploymentActionParams = t.Object({
	companyId: t.String({ format: 'uuid' }),
	deploymentId: t.String({ description: 'hawkBit Distribution Set ID' }),
	targetId: t.String(),
	actionId: t.String(),
});
