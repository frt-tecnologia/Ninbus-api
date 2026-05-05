/**
 * hawkBit Distribution Set API — CRUD, target assignment, statistics.
 * Replaces Mender Deployments.
 */
import { hawkbitRequest } from './http';
import type {
	HawkbitDistributionSet,
	HawkbitDistributionSetType,
	HawkbitPagedResponse,
	HawkbitTarget,
} from './types';

export const hawkbitDistributionSets = {
	list(params?: { offset?: number; limit?: number; sort?: string; q?: string }): Promise<
		HawkbitPagedResponse<HawkbitDistributionSet>
	> {
		return hawkbitRequest({ method: 'GET', path: '/rest/v1/distributionsets', query: params });
	},

	get(dsId: number): Promise<HawkbitDistributionSet> {
		return hawkbitRequest({ method: 'GET', path: `/rest/v1/distributionsets/${dsId}` });
	},

	create(data: {
		name: string;
		version?: string;
		description?: string;
		type?: string;
		modules?: Array<{ id: number }>;
	}): Promise<HawkbitDistributionSet> {
		return hawkbitRequest({ method: 'POST', path: '/rest/v1/distributionsets', body: [data] });
	},

	update(dsId: number, data: { name?: string; description?: string }): Promise<void> {
		return hawkbitRequest({ method: 'PUT', path: `/rest/v1/distributionsets/${dsId}`, body: data });
	},

	delete(dsId: number): Promise<void> {
		return hawkbitRequest({ method: 'DELETE', path: `/rest/v1/distributionsets/${dsId}` });
	},

	/** Assign multiple targets to a distribution set (creates deployments). */
	assignTargets(dsId: number, targetIds: string[], params?: { offline?: boolean }): Promise<void> {
		return hawkbitRequest({
			method: 'POST',
			path: `/rest/v1/distributionsets/${dsId}/assignedTargets`,
			query: { offline: params?.offline },
			body: targetIds.map((id) => ({ id, forceType: 'forced' })),
		});
	},

	getAssignedTargets(
		dsId: number,
		params?: { offset?: number; limit?: number; sort?: string },
	): Promise<HawkbitPagedResponse<HawkbitTarget>> {
		return hawkbitRequest({
			method: 'GET',
			path: `/rest/v1/distributionsets/${dsId}/assignedTargets`,
			query: params,
		});
	},

	getStatistics(dsId: number): Promise<unknown> {
		return hawkbitRequest({ method: 'GET', path: `/rest/v1/distributionsets/${dsId}/statistics` });
	},
};

export const hawkbitDistributionSetTypes = {
	list(): Promise<HawkbitPagedResponse<HawkbitDistributionSetType>> {
		return hawkbitRequest({ method: 'GET', path: '/rest/v1/distributionsettypes' });
	},

	get(typeId: number): Promise<HawkbitDistributionSetType> {
		return hawkbitRequest({ method: 'GET', path: `/rest/v1/distributionsettypes/${typeId}` });
	},

	create(data: {
		key: string;
		name: string;
		description?: string;
	}): Promise<HawkbitDistributionSetType> {
		return hawkbitRequest({ method: 'POST', path: '/rest/v1/distributionsettypes', body: data });
	},
};
