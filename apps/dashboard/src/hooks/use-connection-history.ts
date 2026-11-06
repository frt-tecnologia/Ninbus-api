'use client';
/**
 * useConnectionHistory — ViewModel for the connection timeline Gantt.
 *
 * Loads online/offline transition events for the devices already on screen
 * (company-scoped endpoint, 2k/page, 100k-event safety cap, 3 companies in
 * parallel via the vendored repository), rebuilds per-device segments with the
 * state carried into the window, and discards responses from stale ranges.
 * The screens own the filters — this hook only receives the resolved range
 * and the catalog they already loaded.
 */

import * as React from 'react';
import type { ConnectionDevice } from '@/components/connection-timeline';
import {
	type ConnectionCatalog,
	createConnectionRepository,
	type DashboardCompany,
	type DashboardDevice,
	groupConnectionRecords,
	type HistorySnapshot,
	recordsFromHistory,
	type TimelineRow,
	type TimeRange,
} from '@/components/connection-timeline';
import { http } from '@/lib/api/http';

const repository = createConnectionRepository({
	loadCatalog: () => Promise.reject(new Error('Catálogo injetado pela tela')),
	getEvents: (companyId, query) =>
		http.get(`/companies/${companyId}/devices/connections`, {
			view: query.view,
			from: query.from,
			to: query.to,
			deviceId: query.deviceId,
			limit: query.limit,
			offset: query.offset,
		}),
});

export type ConnectionHistoryState = {
	rows: TimelineRow<ConnectionDevice>[];
	loading: boolean;
	error: string | null;
	retry: () => void;
};

export function useConnectionHistory({
	companies,
	devices,
	range,
	deviceId,
}: {
	companies: readonly DashboardCompany[];
	devices: readonly DashboardDevice[];
	range: TimeRange;
	deviceId?: string;
}): ConnectionHistoryState {
	const [snapshot, setSnapshot] = React.useState<HistorySnapshot | null>(null);
	const [loading, setLoading] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [attempt, setAttempt] = React.useState(0);

	const companiesKey = React.useMemo(
		() =>
			[...new Set(devices.map((d) => d.companyId).filter((id): id is string => !!id))].join(','),
		[devices],
	);
	const from = range[0];
	const to = range[1];
	const hasDevices = devices.length > 0;

	// biome-ignore lint/correctness/useExhaustiveDependencies: attempt is the retry nonce (not read) — re-running the fetch IS the retry; companyIds derives from companiesKey inside
	React.useEffect(() => {
		const controller = new AbortController();
		let stale = false;
		const companyIds = companiesKey ? companiesKey.split(',') : [];
		setLoading(true);
		setError(null);

		if (!hasDevices || companyIds.length === 0) {
			setSnapshot({ range: [from, to], events: [], states: [] });
			setLoading(false);
			return () => {
				stale = true;
				controller.abort();
			};
		}

		repository
			.loadHistory({ companyIds, deviceId, range: [from, to] }, controller.signal)
			.then((result) => {
				if (!stale) setSnapshot(result);
			})
			.catch((cause: unknown) => {
				if (stale || controller.signal.aborted) return;
				setSnapshot(null);
				setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o histórico.');
			})
			.finally(() => {
				if (!stale) setLoading(false);
			});

		return () => {
			stale = true;
			controller.abort();
		};
	}, [companiesKey, deviceId, from, to, hasDevices, attempt]);

	const catalog = React.useMemo<ConnectionCatalog>(
		() => ({ companies: [...companies], devices: [...devices] }),
		[companies, devices],
	);
	const deviceList = React.useMemo(() => [...devices], [devices]);

	const rows = React.useMemo(
		() =>
			snapshot
				? groupConnectionRecords(recordsFromHistory(catalog, deviceList, snapshot), new Set(), true)
				: [],
		[catalog, deviceList, snapshot],
	);

	return { rows, loading, error, retry: () => setAttempt((n) => n + 1) };
}
