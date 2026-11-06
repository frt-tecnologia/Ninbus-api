'use client';

import * as React from 'react';
import { deploymentService } from '@/lib/api';
import { qk } from '@/lib/cache/keys';
import { useQuery } from '@/lib/cache/use-query';
import type { EnrichedDeployment } from '@/types/domain';

/**
 * Every company's deployments in one aggregate query.
 *
 * Cached under `deployments:all:<companyIds>` — the same resource prefix as
 * the per-company keys — so SSE `deployment.*` events and local mutations
 * invalidate it, and overview/deployments/devices screens share one request.
 * Tolerant of per-company failures (allSettled); re-runs only when the
 * company-id set changes.
 */
export function useAllDeployments(companies: Array<{ id: string }>) {
	const key = qk.allDeployments(companies.map((c) => c.id).sort());
	const query = useQuery(
		key,
		React.useCallback(
			() =>
				Promise.allSettled(
					companies.map((c) => deploymentService.list(c.id).then((r) => ({ c, r }))),
				).then((results) => {
					const out: EnrichedDeployment[] = [];
					let failed = 0;
					for (const res of results) {
						if (res.status === 'rejected') {
							failed++;
							continue;
						}
						for (const d of res.value.r.data) out.push({ ...d, companyId: res.value.c.id });
					}
					if (failed === results.length && results.length > 0) {
						throw new Error('Não foi possível carregar deployments.');
					}
					return out;
				}),
			// The callback closes over the fresh `companies`; refetches are gated
			// by the query `key` (company-id set), not by fetcher identity.
			[companies],
		),
	);

	const deployments = query.data ?? [];
	const byCompany = React.useMemo(() => groupByCompany(deployments), [deployments]);
	return {
		deployments,
		byCompany,
		loading: query.loading,
		error: query.error,
		refetch: query.refetch,
	};
}

function groupByCompany(deps: EnrichedDeployment[]): Record<string, EnrichedDeployment[]> {
	const map: Record<string, EnrichedDeployment[]> = {};
	for (const d of deps) {
		const cid = d.companyId;
		if (!cid) continue;
		const bucket = map[cid];
		if (bucket) bucket.push(d);
		else map[cid] = [d];
	}
	return map;
}
