'use client';
/**
 * ConnectionHistorySection — the "Conexão dos dispositivos" card with its own
 * contextual filter bar (the same unified SearchFilterBar of the screens):
 * search by device, connection state, company (multi-company contexts) and
 * the period, which drives the Gantt window. Screens pass the catalog they
 * already have plus the period to start from; the section owns local filter
 * state afterwards.
 */

import * as React from 'react';
import type { FilterChip, FilterField } from '@/components/arc/filter-toolbar/filter-toolbar';
import {
	type ConnectionDevice,
	ConnectionHistoryCard,
	type DashboardCompany,
	type DashboardDevice,
	filterConnectionRecords,
	groupConnectionRecords,
	type HistoryStatus,
	type TimelineRecord,
} from '@/components/connection-timeline';
import { useConnectionHistory } from '@/hooks/use-connection-history';
import { type Period, resolvePeriod } from '@/lib/time/period';
import { SearchFilterBar } from './search-filter-bar';

const STATUS_OPTIONS = [
	{ value: 'online', label: 'Com conexão' },
	{ value: 'offline', label: 'Com desconexão' },
	{ value: 'unknown', label: 'Sem histórico' },
];

export function ConnectionHistorySection({
	companies,
	devices,
	initialPeriod = null,
	deviceId,
	onManageDevice,
	title = 'Conexão dos dispositivos',
}: {
	companies: readonly DashboardCompany[];
	devices: readonly DashboardDevice[];
	initialPeriod?: Period | null;
	deviceId?: string;
	onManageDevice?: (device: ConnectionDevice) => void;
	title?: string;
}) {
	const [localPeriod, setLocalPeriod] = React.useState<Period | null | undefined>(undefined);
	const [query, setQuery] = React.useState('');
	const [filters, setFilters] = React.useState<FilterChip[]>([]);
	const period = localPeriod === undefined ? initialPeriod : localPeriod;

	const range = React.useMemo<[number, number]>(() => {
		const window = period ? resolvePeriod(period) : null;
		const to = window?.to.getTime() ?? Date.now();
		const from = window?.from.getTime() ?? to - 24 * 3_600_000;
		return [from, to];
	}, [period]);

	const history = useConnectionHistory({ companies, devices, range, deviceId });

	const status = (filters.find((f) => f.id === 'status')?.value as HistoryStatus) ?? 'all';
	const companyId = filters.find((f) => f.id === 'company')?.value ?? null;
	const showCompanyField = companies.length > 1;

	const fields: FilterField[] = [
		{ id: 'status', label: 'Conexão', options: STATUS_OPTIONS },
		...(showCompanyField
			? [
					{
						id: 'company',
						label: 'Empresa',
						options: companies.map((company) => ({
							value: company.id,
							label: company.name,
						})),
					},
				]
			: []),
	];

	const rows = React.useMemo(() => {
		const records: TimelineRecord<ConnectionDevice>[] = history.rows
			.filter(
				(row): row is { kind: 'device'; record: TimelineRecord<ConnectionDevice> } =>
					row.kind === 'device',
			)
			.map((row) => row.record);
		const filtered = filterConnectionRecords(records, query, status, range).filter(
			(record) => !companyId || record.device.companyId === companyId,
		);
		return groupConnectionRecords(filtered, new Set(), showCompanyField);
	}, [history.rows, query, status, companyId, range, showCompanyField]);

	return (
		<ConnectionHistoryCard
			title={title}
			rows={rows}
			range={range}
			loading={history.loading}
			error={history.error}
			onRetry={history.retry}
			timeZone="America/Sao_Paulo"
			dense
			onManageDevice={onManageDevice}
			filters={
				<SearchFilterBar
					label="Dispositivos"
					query={query}
					onQueryChange={setQuery}
					fields={fields}
					filters={filters}
					onFiltersChange={setFilters}
					temporal
					period={period}
					onPeriodChange={setLocalPeriod}
				/>
			}
		/>
	);
}
