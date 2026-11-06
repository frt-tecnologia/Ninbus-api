import type {
	ConnectionQuery,
	ConnectionRepository,
	DashboardDataSource,
	HistorySnapshot,
} from './contracts';

export function createConnectionRepository(source: DashboardDataSource): ConnectionRepository {
	return {
		loadCatalog: (signal) => source.loadCatalog(signal),
		loadOverview: source.loadOverview,
		async loadHistory(query: ConnectionQuery, signal: AbortSignal): Promise<HistorySnapshot> {
			const from = new Date(query.range[0]).toISOString();
			const to = new Date(query.range[1]).toISOString();
			const range = [Date.parse(from), Date.parse(to)] as const;
			const companyIds = [...new Set(query.companyIds)];
			const snapshots: HistorySnapshot[] = new Array(companyIds.length);
			let next = 0;
			let totalEvents = 0;
			let stopped = false;
			async function worker() {
				while (next < companyIds.length && !stopped) {
					const index = next++;
					const companyId = companyIds[index];
					const events: HistorySnapshot['events'][number][] = [];
					const states = new Map<string, HistorySnapshot['states'][number]>();
					let offset = 0;
					while (true) {
						signal.throwIfAborted();
						if (stopped) return;
						const page = await source.getEvents(
							companyId,
							{
								from,
								to,
								view: 'events',
								deviceId: query.deviceId,
								limit: 2000,
								offset,
							},
							signal,
						);
						signal.throwIfAborted();
						if (Date.parse(page.range.from) !== range[0] || Date.parse(page.range.to) !== range[1])
							throw new Error('O período retornado não corresponde à consulta. Tente novamente.');
						totalEvents += page.data.length;
						if (totalEvents > 100000)
							throw new Error(
								'Histórico muito extenso. Reduza o período ou selecione um dispositivo.',
							);
						events.push(...page.data);
						for (const state of page.states) states.set(state.deviceId, state);
						if (!page.hasMore || page.data.length === 0) break;
						offset += page.data.length;
						if (offset >= 100000)
							throw new Error(
								'Histórico muito extenso. Reduza o período ou selecione um dispositivo.',
							);
					}
					snapshots[index] = {
						range,
						events,
						states: [...states.values()],
					};
				}
			}
			await Promise.all(
				Array.from({ length: Math.min(3, companyIds.length) }, () => worker()),
			).catch((error) => {
				stopped = true;
				throw error;
			});
			return {
				range,
				events: snapshots.flatMap((s) => s.events),
				states: snapshots.flatMap((s) => s.states),
			};
		},
	};
}
