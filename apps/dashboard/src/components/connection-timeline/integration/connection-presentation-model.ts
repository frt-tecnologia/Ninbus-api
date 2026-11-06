import type { FilterChip, FilterField } from '@/components/arc/filter-toolbar/filter-toolbar';
import type { TimelineRecord, TimelineRow, TimeRange } from '../types';
import { normalizeSearch, rangeLabel } from './connection-model';
import type {
	ConnectionDevice,
	DashboardCompany,
	DashboardDevice,
	HistoryStatus,
} from './contracts';

const statusOptions = [
	{ value: 'online', label: 'Com conexão' },
	{ value: 'offline', label: 'Com desconexão' },
	{ value: 'unknown', label: 'Sem histórico' },
];
export function connectionFilterFields(companies: readonly DashboardCompany[]): FilterField[] {
	return [
		{
			id: 'company',
			label: 'Empresa',
			options: companies.map((company) => ({
				value: company.id,
				label: company.name,
			})),
		},
		{ id: 'status', label: 'Conexão no período', options: statusOptions },
		{
			id: 'period',
			label: 'Data e hora',
			options: [
				{ value: '1h', label: 'Última hora' },
				{ value: '24h', label: 'Últimas 24 horas' },
				{ value: '7d', label: 'Últimos 7 dias' },
				{ value: 'custom', label: 'Personalizado' },
			],
		},
	];
}
export function connectionFilterChips({
	companies,
	devices,
	companyId,
	deviceId,
	status,
	range,
}: {
	companies: readonly DashboardCompany[];
	devices: readonly DashboardDevice[];
	companyId: string | null;
	deviceId: string | null;
	status: HistoryStatus;
	range: TimeRange;
}): FilterChip[] {
	const chips: FilterChip[] = [
		{
			id: 'period',
			label: 'Período',
			value: 'custom',
			displayValue: rangeLabel(range),
		},
	];
	if (companyId)
		chips.unshift({
			id: 'company',
			label: 'Empresa',
			value: companyId,
			displayValue: companies.find((company) => company.id === companyId)?.name,
		});
	if (status !== 'all')
		chips.push({
			id: 'status',
			label: 'Conexão',
			value: status,
			displayValue: statusOptions.find((option) => option.value === status)?.label,
		});
	if (deviceId)
		chips.push({
			id: 'device',
			label: 'Dispositivo',
			value: deviceId,
			displayValue: devices.find((device) => device.id === deviceId)?.name,
		});
	return chips;
}
export function filterConnectionRecords(
	records: readonly TimelineRecord<ConnectionDevice>[],
	query: string,
	status: HistoryStatus,
	range: TimeRange,
) {
	const term = normalizeSearch(query.trim());
	return records
		.filter((record) => {
			const matches = normalizeSearch(
				`${record.device.name} ${record.device.subtitle ?? ''} ${record.device.id} ${record.device.companyName ?? ''}`,
			).includes(term);
			return (
				matches &&
				(status === 'all' ||
					(status === 'online' && record.onlineMs > 0) ||
					(status === 'offline' && record.offlineMs > 0) ||
					(status === 'unknown' && record.unknownMs === range[1] - range[0]))
			);
		})
		.sort(
			(a, b) =>
				(a.device.companyName ?? '').localeCompare(b.device.companyName ?? '') ||
				a.device.name.localeCompare(b.device.name, 'pt-BR', { numeric: true }),
		);
}
export function groupConnectionRecords(
	records: readonly TimelineRecord<ConnectionDevice>[],
	collapsed: ReadonlySet<string>,
	groupCompanies: boolean,
): TimelineRow<ConnectionDevice>[] {
	const rows: TimelineRow<ConnectionDevice>[] = [];
	const groups = new Map<string, TimelineRecord<ConnectionDevice>[]>();
	for (const record of records) {
		const id = record.device.companyId ?? 'unassigned';
		const group = groups.get(id);
		if (group) group.push(record);
		else groups.set(id, [record]);
	}
	for (const [id, group] of groups) {
		if (groupCompanies)
			rows.push({
				kind: 'company',
				company: id,
				companyLabel: group[0].device.companyName ?? 'Sem empresa',
				count: group.length,
				collapsed: collapsed.has(id),
			});
		if (!groupCompanies || !collapsed.has(id))
			rows.push(...group.map((record) => ({ kind: 'device' as const, record })));
	}
	return rows;
}
