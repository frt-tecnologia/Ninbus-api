'use client';

import { useCallback, useEffect, useState } from 'react';
import { deploymentService } from '@/lib/api';
import { subscribeData } from '@/lib/data-events';
import type { EnrichedDeployment } from '@/types/domain';

/**
 * Fetch every company's deployments in parallel (tolerant of per-company
 * failures), tag each with its companyId, and expose both a flat list and a
 * companyId→deployments map. Shared by the overview and deployments pages so
 * the data is fetched ONCE per page, not N times.
 *
 * Re-runs only when the company-id set changes (stable key), plus an explicit
 * `refetch` for the retry button. Returns `byCompany` for per-company charts
 * and `deployments` for cross-company views.
 */
export function useAllDeployments(companies: Array<{ id: string }>) {
	const [deployments, setDeployments] = useState<EnrichedDeployment[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [nonce, setNonce] = useState(0);
	const key = companies.map((c) => c.id).join(',');
	const refetch = useCallback(() => setNonce((n) => n + 1), []);

	// Reactivity: subscribe to the global data-mutation bus so this hook refetches
	// whenever any dialog/inline action mutates data (create/delete deployment,
	// member changes, etc.). useFetch does this by default; this custom hook
	// must do the same or the deployments + overview pages go stale on actions.
	useEffect(() => subscribeData(() => setNonce((n) => n + 1)), []);

	useEffect(() => {
		if (!companies.length) {
			setDeployments([]);
			setLoading(false);
			return;
		}
		let active = true;
		setLoading(true);
		setError(null);
		(async () => {
			try {
				const results = await Promise.allSettled(
					companies.map((c) => deploymentService.list(c.id).then((r) => ({ c, r }))),
				);
				if (!active) return;
				const out: EnrichedDeployment[] = [];
				let failed = 0;
				for (const res of results) {
					if (res.status !== 'fulfilled') {
						failed++;
						continue;
					}
					for (const d of res.value.r.data) out.push({ ...d, companyId: res.value.c.id });
				}
				setDeployments(out);
				setError(failed === results.length ? 'Não foi possível carregar deployments.' : null);
			} catch {
				if (active) setError('Erro inesperado ao carregar deployments.');
			} finally {
				if (active) setLoading(false);
			}
		})();
		return () => {
			active = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key, nonce]);

	const byCompany = groupByCompany(deployments);
	return { deployments, byCompany, loading, error, refetch };
}

function groupByCompany(deps: EnrichedDeployment[]): Record<string, EnrichedDeployment[]> {
	const map: Record<string, EnrichedDeployment[]> = {};
	for (const d of deps) {
		const cid = d.companyId;
		if (!cid) continue;
		(map[cid] ??= []).push(d);
	}
	return map;
}
