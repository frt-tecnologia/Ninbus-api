/**
 * hawkBit Distribution Set API — CRUD, target assignment, statistics.
 * Replaces Mender Deployments.
 */
import { hawkbitRequest } from './http';
import type {
	HawkbitDistributionSet,
	HawkbitDistributionSetType,
	HawkbitDSStatistics,
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

	/** Find all distribution sets that contain a given software module. */
	findByModule(smId: number): Promise<HawkbitDistributionSet[]> {
		return hawkbitRequest<HawkbitPagedResponse<HawkbitDistributionSet>>({
			method: 'GET',
			path: '/rest/v1/distributionsets',
			query: { q: `modules.id==${smId}`, limit: 100 },
		}).then((res) => res.content);
	},

	create(data: {
		name: string;
		version?: string;
		description?: string;
		type?: string;
		modules?: Array<{ id: number }>;
	}): Promise<HawkbitDistributionSet> {
		return hawkbitRequest<HawkbitDistributionSet[]>({
			method: 'POST',
			path: '/rest/v1/distributionsets',
			body: [data],
		}).then((arr) => arr[0]);
	},

	update(dsId: number, data: { name?: string; description?: string }): Promise<void> {
		return hawkbitRequest({ method: 'PUT', path: `/rest/v1/distributionsets/${dsId}`, body: data });
	},

	delete(dsId: number): Promise<void> {
		return hawkbitRequest({ method: 'DELETE', path: `/rest/v1/distributionsets/${dsId}` });
	},

	/** Fetch multiple distribution sets by ID (for company-scoped listing via RSQL). */
	async listByIds(dsIds: number[]): Promise<HawkbitDistributionSet[]> {
		if (dsIds.length === 0) return [];
		const batchSize = 100;
		const all: HawkbitDistributionSet[] = [];
		for (let i = 0; i < dsIds.length; i += batchSize) {
			const batch = dsIds.slice(i, i + batchSize);
			const q = `id=in=(${batch.join(',')})`;
			const result = await hawkbitRequest<HawkbitPagedResponse<HawkbitDistributionSet>>({
				method: 'GET',
				path: '/rest/v1/distributionsets',
				query: { q, limit: batchSize },
			});
			all.push(...result.content);
		}
		return all;
	},

	/** Assign multiple targets to a distribution set (creates deployments). */
	assignTargets(dsId: number, targetIds: string[], params?: { offline?: boolean; type?: 'forced' | 'soft' | 'timeforced' | 'downloadonly' }): Promise<void> {
		return hawkbitRequest({
			method: 'POST',
			path: `/rest/v1/distributionsets/${dsId}/assignedTargets`,
			query: { offline: params?.offline },
			// hawkBit expects field name 'type' (not 'forceType') for the force type.
			// Default is 'forced' which is the correct value for our use case.
			body: targetIds.map((id) => ({ id, type: params?.type ?? 'forced' })),
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

	getStatistics(dsId: number): Promise<HawkbitDSStatistics> {
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
		modules?: Array<{ id: number }>;
	}): Promise<HawkbitDistributionSetType> {
		return hawkbitRequest<HawkbitDistributionSetType[]>({
			method: 'POST',
			path: '/rest/v1/distributionsettypes',
			body: [data],
		}).then((arr) => arr[0]);
	},

	/** Assign a mandatory SM type to a DS type. hawkBit expects raw ID (not JSON object). */
	assignMandatorySMType(dsTypeId: number, smTypeId: number): Promise<void> {
		return hawkbitRequest({
			method: 'POST',
			path: `/rest/v1/distributionsettypes/${dsTypeId}/mandatorymoduletypes`,
			body: smTypeId,
			headers: { 'Content-Type': 'application/json' },
		});
	},
};
