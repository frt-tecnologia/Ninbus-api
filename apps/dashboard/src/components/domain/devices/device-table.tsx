'use client';

import { type Column, DataTable } from '@/components/data/data-table';
import { Id, Relative, SearchField, Signal, Time, Toolbar } from '@/components/system';
import { Button } from '@/components/ui/button';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { connectionSignal, deviceSignal } from '@/lib/design/tokens';
import { exportToExcel, exportToPdf } from '@/lib/export';
import { formatDateTime } from '@/lib/utils';
import type { Company, Device } from '@/types/domain';
import { FileSpreadsheet, FileText } from 'lucide-react';
import * as React from 'react';
import { DeviceCategoryEditor } from './device-category-editor';

/**
 * Dense device table — the operator's primary fleet view. Serials/keys in mono,
 * status + connection as SIGNAL geometry, company filter + client search +
 * sort. Export to PDF/Excel stays client-side (no API cost).
 */
export function DeviceTable({
	devices,
	companies,
	loading,
	error,
	onRetry,
}: {
	devices: Device[];
	companies: Company[];
	loading: boolean;
	error: string | null;
	onRetry: () => void;
}) {
	const [search, setSearch] = React.useState('');
	const [company, setCompany] = React.useState<string>('all');

	const companyName = (id: string | null) =>
		!id ? 'Sem empresa' : (companies.find((c) => c.id === id)?.name ?? id.slice(0, 8));

	const filtered = React.useMemo(() => {
		const term = search.trim().toLowerCase();
		return devices.filter((d) => {
			if (company !== 'all' && d.companyId !== company) return false;
			if (!term) return true;
			return [d.serialNumber, d.serialDisplay, d.name, d.hawkbitTargetId].some((v) =>
				(v ?? '').toLowerCase().includes(term),
			);
		});
	}, [devices, search, company]);

	const columns: Column<Device>[] = [
		{
			key: 'serial',
			header: 'Serial',
			sortValue: (d) => d.serialDisplay ?? d.serialNumber ?? '',
			render: (d) => (
				<div className="flex flex-col">
					<Id value={d.serialDisplay ?? d.serialNumber ?? '—'} copy />
					{d.name && <span className="text-xs text-muted-foreground">{d.name}</span>}
				</div>
			),
		},
		{
			key: 'company',
			header: 'Empresa',
			sortValue: (d) => companyName(d.companyId),
			render: (d) => <span className="text-sm">{companyName(d.companyId)}</span>,
		},
		{
			key: 'status',
			header: 'Status',
			sortValue: (d) => d.status,
			render: (d) => <Signal token={deviceSignal(d.status)} size="sm" />,
		},
		{
			key: 'conn',
			header: 'Conexão',
			sortValue: (d) => d.connectionStatus ?? 'unknown',
			render: (d) => <Signal token={connectionSignal(d.connectionStatus)} size="sm" />,
		},
		{
			key: 'lastSeen',
			header: 'Última conexão',
			sortValue: (d) => d.lastSeenAt ?? '',
			render: (d) => <Relative value={d.lastSeenAt} />,
		},
		{
			key: 'createdAt',
			header: 'Adicionado',
			sortValue: (d) => d.createdAt,
			render: (d) => <Time value={d.createdAt} />,
		},
		{
			key: 'groups',
			header: 'Grupos',
			render: (d) =>
				d.companyId ? (
					<DeviceCategoryEditor companyId={d.companyId} deviceId={d.id} deviceName={d.name} />
				) : (
					<span className="text-muted-foreground">—</span>
				),
		},
	];

	const exportCols = [
		{ header: 'Serial', accessor: (d: Device) => d.serialDisplay ?? d.serialNumber ?? '—' },
		{ header: 'Nome', accessor: (d: Device) => d.name ?? '—' },
		{ header: 'Empresa', accessor: (d: Device) => companyName(d.companyId) },
		{ header: 'Status', accessor: (d: Device) => deviceSignal(d.status).label },
		{ header: 'Conexão', accessor: (d: Device) => connectionSignal(d.connectionStatus).label },
		{ header: 'Última conexão', accessor: (d: Device) => formatDateTime(d.lastSeenAt) },
		{ header: 'Adicionado', accessor: (d: Device) => formatDateTime(d.createdAt) },
	];

	return (
		<div className="flex flex-col gap-3">
			<Toolbar
				actions={
					<div className="flex gap-1.5">
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() =>
								exportToPdf(filtered, exportCols, {
									title: 'Dispositivos — Ninbus',
									fileName: 'dispositivos-ninbus',
								})
							}
						>
							<FileText className="h-4 w-4" />
							PDF
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() =>
								exportToExcel(filtered, exportCols, {
									fileName: 'dispositivos-ninbus',
									sheetName: 'Dispositivos',
								})
							}
						>
							<FileSpreadsheet className="h-4 w-4" />
							Excel
						</Button>
					</div>
				}
			>
				<SearchField
					value={search}
					onChange={setSearch}
					placeholder="Buscar por serial, nome, target ID…"
					className="max-w-xs"
				/>
				<Select value={company} onValueChange={setCompany}>
					<SelectTrigger className="h-9 w-48">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">Todas as empresas</SelectItem>
						{companies.map((c) => (
							<SelectItem key={c.id} value={c.id}>
								{c.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</Toolbar>

			<DataTable
				columns={columns}
				rows={filtered}
				rowKey={(d) => d.id}
				loading={loading}
				error={error}
				onRetry={onRetry}
				empty={
					<div className="py-12 text-center text-sm text-muted-foreground">
						{devices.length === 0
							? 'Nenhum dispositivo provisionado ainda.'
							: 'Nenhum dispositivo corresponde aos filtros.'}
					</div>
				}
			/>
			<p className="text-xs text-muted-foreground">
				{filtered.length} de {devices.length} dispositivos
			</p>
		</div>
	);
}
