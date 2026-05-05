/**
 * hawkBit Target API — CRUD, attributes, actions, assignments.
 * Replaces Mender Device Auth + Inventory + Device Connect.
 */
import { hawkbitRequest } from './http';
import type {
	HawkbitAction,
	HawkbitActionStatus,
	HawkbitDistributionSet,
	HawkbitPagedResponse,
	HawkbitTarget,
	HawkbitTargetAttributes,
	HawkbitTargetRequestBody,
} from './types';

export const hawkbitTargets = {
	list(params?: { offset?: number; limit?: number; sort?: string; q?: string }): Promise<
		HawkbitPagedResponse<HawkbitTarget>
	> {
		return hawkbitRequest({
			method: 'GET',
			path: '/rest/v1/targets',
			query: params,
		});
	},

	get(targetId: string): Promise<HawkbitTarget> {
		return hawkbitRequest({
			method: 'GET',
			path: `/rest/v1/targets/${encodeURIComponent(targetId)}`,
		});
	},

	create(
		data: HawkbitTargetRequestBody | HawkbitTargetRequestBody[],
	): Promise<HawkbitTarget[]> {
		return hawkbitRequest<HawkbitTarget[]>({
			method: 'POST',
			path: '/rest/v1/targets',
			body: Array.isArray(data) ? data : [data],
		});
	},

	update(targetId: string, data: Partial<HawkbitTargetRequestBody>): Promise<void> {
		return hawkbitRequest({
			method: 'PUT',
			path: `/rest/v1/targets/${encodeURIComponent(targetId)}`,
			body: data,
		});
	},

	delete(targetId: string): Promise<void> {
		return hawkbitRequest({
			method: 'DELETE',
			path: `/rest/v1/targets/${encodeURIComponent(targetId)}`,
		});
	},

	getAttributes(targetId: string): Promise<HawkbitTargetAttributes> {
		return hawkbitRequest({
			method: 'GET',
			path: `/rest/v1/targets/${encodeURIComponent(targetId)}/attributes`,
		});
	},

	getActions(
		targetId: string,
		params?: { offset?: number; limit?: number; sort?: string },
	): Promise<HawkbitPagedResponse<HawkbitAction>> {
		return hawkbitRequest({
			method: 'GET',
			path: `/rest/v1/targets/${encodeURIComponent(targetId)}/actions`,
			query: params,
		});
	},

	getAction(targetId: string, actionId: number): Promise<HawkbitAction> {
		return hawkbitRequest({
			method: 'GET',
			path: `/rest/v1/targets/${encodeURIComponent(targetId)}/actions/${actionId}`,
		});
	},

	cancelAction(targetId: string, actionId: number, force?: boolean): Promise<void> {
		return hawkbitRequest({
			method: 'DELETE',
			path: `/rest/v1/targets/${encodeURIComponent(targetId)}/actions/${actionId}`,
			query: { force: force ?? true },
		});
	},

	cancelAllActions(targetId: string, keepLast?: number): Promise<void> {
		return hawkbitRequest({
			method: 'DELETE',
			path: `/rest/v1/targets/${encodeURIComponent(targetId)}/actions`,
			query: { keepLast },
		});
	},

	getActionStatus(
		targetId: string,
		actionId: number,
		params?: { offset?: number; limit?: number },
	): Promise<HawkbitPagedResponse<HawkbitActionStatus>> {
		return hawkbitRequest({
			method: 'GET',
			path: `/rest/v1/targets/${encodeURIComponent(targetId)}/actions/${actionId}/status`,
			query: params,
		});
	},

	getAssignedDS(targetId: string): Promise<HawkbitDistributionSet[]> {
		return hawkbitRequest({
			method: 'GET',
			path: `/rest/v1/targets/${encodeURIComponent(targetId)}/assignedDS`,
		});
	},

	assignDS(
		targetId: string,
		dsId: number,
		params?: { forceType?: string; offline?: boolean },
	): Promise<void> {
		return hawkbitRequest({
			method: 'POST',
			path: `/rest/v1/targets/${encodeURIComponent(targetId)}/assignedDS`,
			query: { offline: params?.offline },
			body: { id: dsId, forceType: params?.forceType ?? 'forced' },
		});
	},
};
