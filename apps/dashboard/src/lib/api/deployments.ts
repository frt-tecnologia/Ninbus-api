import { http } from './http';
import type {
	EnrichedDeployment,
	TargetStatusTrail,
	TargetDeploymentStatus,
	ListResponse,
	DetailResponse,
} from '@/types/domain';

/**
 * Deployment service — observability of OTA deployments (super admin view).
 *
 * Endpoints consumed (super admin bypasses companyRole via macro):
 *  GET /api/companies/:id/deployments                     → list deployments
 *  GET /api/companies/:id/deployments/:dsId/target-statuses
 *                                                          → per-device phase/progress
 *  GET /api/companies/:id/deployments/:dsId/targets/:targetId/status-trail
 *                                                          → device event timeline
 */
export const deploymentService = {
	async list(
		companyId: string,
		opts?: { offset?: number; limit?: number },
	): Promise<ListResponse<EnrichedDeployment>> {
		return http.get<ListResponse<EnrichedDeployment>>(
			`/companies/${companyId}/deployments`,
			opts,
		);
	},

	/** Per-target status for a deployment (which devices updated / failed). */
	async targetStatuses(
		companyId: string,
		deploymentId: string | number,
	): Promise<ListResponse<TargetDeploymentStatus>> {
		return http.get<ListResponse<TargetDeploymentStatus>>(
			`/companies/${companyId}/deployments/${deploymentId}/target-statuses`,
			{ limit: 500 },
		);
	},

	async statusTrail(
		companyId: string,
		deploymentId: string,
		targetId: string,
	): Promise<TargetStatusTrail> {
		return http
			.get<DetailResponse<TargetStatusTrail>>(
				`/companies/${companyId}/deployments/${deploymentId}/targets/${targetId}/status-trail`,
			)
			.then((r) => r.data);
	},
};
