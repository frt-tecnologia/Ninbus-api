/**
 * Trail response schemas — enriched deployment status for frontend.
 */
import { t } from 'elysia';

export const TargetActionStatusSchema = t.Object({
	id: t.Number(),
	type: t.String(),
	active: t.Boolean(),
	status: t.String(),
	createdAt: t.Optional(t.Number()),
	phase: t.String({
		description: 'Semantic phase: assigned, pending, downloading, downloaded, installing, installed, error, canceled, unknown',
	}),
	progress: t.Nullable(t.Number({ description: 'Download progress 0-100 or null' })),
	message: t.String({ description: 'Latest status message from device or server' }),
});

export const TargetDeploymentStatusSchema = t.Object({
	controllerId: t.String(),
	name: t.String(),
	updateStatus: t.String(),
	action: t.Nullable(TargetActionStatusSchema),
});

export const EnrichedActionStatusEntrySchema = t.Object({
	id: t.Number(),
	type: t.String(),
	messages: t.Array(t.String()),
	reportedAt: t.Nullable(t.Number()),
	progress: t.Nullable(t.Number()),
	phase: t.String(),
	displayMessage: t.String(),
});

export const TargetStatusTrailDataSchema = t.Object({
	controllerId: t.String(),
	name: t.String(),
	actionId: t.Number(),
	actionType: t.String(),
	actionStatus: t.String(),
	active: t.Boolean(),
	phase: t.String(),
	progress: t.Nullable(t.Number()),
	currentMessage: t.String(),
	trail: t.Array(EnrichedActionStatusEntrySchema),
});

export const TargetStatusesResponseSchema = t.Object({
	data: t.Array(TargetDeploymentStatusSchema),
	total: t.Number(),
});

export const TargetStatusTrailResponseSchema = t.Object({
	data: TargetStatusTrailDataSchema,
});
