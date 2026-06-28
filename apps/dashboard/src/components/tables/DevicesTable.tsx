'use client';

import { useMemo, useState } from 'react';
import type { Device, Company } from '@/types/domain';
import {
	deviceStatusMeta,
	connectionMeta,
	formatRelative,
	formatDateTime,
} from '@/lib/utils';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { SearchToolbar } from '@/components/tables/SearchToolbar';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { EmptyState, ErrorState } from '@/components/ui/State';
import { exportToPdf, exportToExcel } from '@/lib/export';
import { Plus, FileSpreadsheet, FileText } from 'lucide-react';

type SortKey = 'lastSeen' | 'createdAt';

export function DevicesTable({
	devices,
	companies,
	loading,
	error,
	onRetry,
	onProvision,
}: {
	devices: Device[];
	companies: Company[];
	loading: boolean;
	error: string | null;
	onRetry: () => void;
	onProvision: () => void;
}) {
	const [search, setSearch] = useState('');
	const [companyId, setCompanyId] = useState('');
	const [sort, setSort] = useState<SortKey>('lastSeen');

	const filtered = useMemo(() => {
		const term = search.trim().toLowerCase();
		return devices.filter((d) => {
			if (companyId && d.companyId !== companyId) return false;
			if (!term) return true;
			return (
				(d.serialNumber ?? '').toLowerCase().includes(term) ||
				(d.serialDisplay ?? '').toLowerCase().includes(term) ||
				(d.name ?? '').toLowerCase().includes(term) ||
				(d.hawkbitTargetId ?? '').toLowerCase().includes(term)
			);
		});
	}, [devices, search, companyId]);

	const columns: Column<Device>[] = [
		{
			key: 'serial',
			header: 'Serial',
			sortable: true,
			sortValue: (d) => d.serialDisplay ?? d.serialNumber ?? '',
			render: (d) => (
				<div>
					<div className="font-medium text-gray-900">
						{d.serialDisplay ?? d.serialNumber ?? '—'}
					</div>
					<div className="text-xs text-gray-400">{d.name || 'sem nome'}</div>
				</div>
			),
		},
		{
			key: 'company',
			header: 'Empresa',
			sortable: true,
			sortValue: (d) => companyName(d.companyId, companies),
			render: (d) => (
				<span className="text-gray-600">{companyName(d.companyId, companies)}</span>
			),
		},
		{
			key: 'status',
			header: 'Status',
			sortable: true,
			sortValue: (d) => d.status,
			render: (d) => <StatusBadge meta={deviceStatusMeta(d.status)} />,
		},
		{
			key: 'connection',
			header: 'Conexão',
			sortable: true,
			sortValue: (d) => d.connectionStatus ?? 'unknown',
			render: (d) => <StatusBadge meta={connectionMeta(d.connectionStatus)} />,
		},
		{
			key: 'lastSeen',
			header: 'Última conexão',
			sortable: true,
			sortValue: (d) => d.lastSeenAt ?? '',
			render: (d) => (
				<span title={formatDateTime(d.lastSeenAt)}>
					{formatRelative(d.lastSeenAt)}
				</span>
			),
		},
		{
			key: 'createdAt',
			header: 'Adicionado em',
			sortable: true,
			sortValue: (d) => d.createdAt,
			render: (d) => (
				<span className="text-gray-500">{formatDateTime(d.createdAt)}</span>
			),
		},
	];

	if (error) return <ErrorState message={error} onRetry={onRetry} />;

	return (
		<div>
			<SearchToolbar
				search={search}
				onSearchChange={setSearch}
				searchPlaceholder="Buscar por serial, nome ou target ID..."
				actions={[
					{
						label: 'PDF',
						variant: 'outline',
						icon: <FileText className="h-4 w-4" />,
						onClick: () => exportDevicesPdf(filtered, companies),
					},
					{
						label: 'Excel',
						variant: 'outline',
						icon: <FileSpreadsheet className="h-4 w-4" />,
						onClick: () => exportDevicesExcel(filtered, companies),
					},
					{
						label: 'Cadastrar',
						variant: 'primary',
						icon: <Plus className="h-4 w-4" />,
						onClick: onProvision,
					},
				]}
			>
				<Select
					value={companyId}
					onChange={(e) => setCompanyId(e.target.value)}
					className="w-auto"
				>
					<option value="">Todas as empresas</option>
					{companies.map((c) => (
						<option key={c.id} value={c.id}>
							{c.name}
						</option>
					))}
				</Select>
				<Select
					value={sort}
					onChange={(e) => setSort(e.target.value as SortKey)}
					className="w-auto"
				>
					<option value="lastSeen">Ordenar: última conexão</option>
					<option value="createdAt">Ordenar: mais recente</option>
				</Select>
			</SearchToolbar>

			<div className="rounded-xl border border-gray-200 bg-white">
				<DataTable
					columns={columns}
					rows={forceSort(filtered, sort)}
					rowKey={(d) => d.id}
					loading={loading}
					emptyState={
						<EmptyState
							title="Nenhum dispositivo encontrado"
							description={
								search || companyId
									? 'Ajuste os filtros ou tente outro termo.'
									: 'Cadastre o primeiro dispositivo da plataforma.'
							}
						/>
					}
				/>
			</div>
			<p className="mt-2 text-xs text-gray-400">
				{filtered.length} de {devices.length} dispositivos
			</p>
		</div>
	);
}

function companyName(id: string | null, companies: Company[]): string {
	if (!id) return 'Sem empresa';
	return companies.find((c) => c.id === id)?.name ?? id.slice(0, 8);
}

// Client-side forced sort (overrides DataTable's internal sort for the dropdown).
function forceSort(devices: Device[], sort: SortKey): Device[] {
	const copy = [...devices];
	if (sort === 'lastSeen') {
		copy.sort((a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''));
	} else {
		copy.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
	}
	return copy;
}

function exportDevicesPdf(devices: Device[], companies: Company[]) {
	exportToPdf(
		devices,
		[
			{ header: 'Serial', accessor: (d) => d.serialDisplay ?? d.serialNumber ?? '—' },
			{ header: 'Nome', accessor: (d) => d.name ?? '—' },
			{ header: 'Empresa', accessor: (d) => companyName(d.companyId, companies) },
			{ header: 'Status', accessor: (d) => d.status },
			{ header: 'Conexão', accessor: (d) => d.connectionStatus ?? '—' },
			{
				header: 'Última conexão',
				accessor: (d) => formatDateTime(d.lastSeenAt),
			},
			{ header: 'Adicionado em', accessor: (d) => formatDateTime(d.createdAt) },
		],
		{
			title: 'Dispositivos — Ninbus',
			subtitle: `Exportado em ${formatDateTime(new Date().toISOString())}`,
			fileName: 'dispositivos-ninbus',
		},
	);
}

function exportDevicesExcel(devices: Device[], companies: Company[]) {
	exportToExcel(
		devices,
		[
			{ header: 'Serial', accessor: (d) => d.serialDisplay ?? d.serialNumber ?? '—' },
			{ header: 'Nome', accessor: (d) => d.name ?? '—' },
			{ header: 'Empresa', accessor: (d) => companyName(d.companyId, companies) },
			{ header: 'Status', accessor: (d) => d.status },
			{ header: 'Conexão', accessor: (d) => d.connectionStatus ?? '—' },
			{
				header: 'Última conexão',
				accessor: (d) => formatDateTime(d.lastSeenAt),
			},
			{ header: 'Adicionado em', accessor: (d) => formatDateTime(d.createdAt) },
		],
		{ fileName: 'dispositivos-ninbus', sheetName: 'Dispositivos' },
	);
}
