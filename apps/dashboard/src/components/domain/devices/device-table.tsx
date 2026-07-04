'use client';

import * as React from 'react';
import Link from 'next/link';
import { FileText, FileSpreadsheet } from 'lucide-react';
import type { Device, Company } from '@/types/domain';
import { deviceSignal, connectionSignal } from '@/lib/design/tokens';
import { DataTable, type Column } from '@/components/data/data-table';
import { Signal, Id, Relative, Time, Toolbar } from '@/components/system';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { exportToPdf, exportToExcel } from '@/lib/export';
import { formatDateTime } from '@/lib/utils';

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
		!id ? 'Sem empresa' : companies.find((c) => c.id === id)?.name ?? id.slice(0, 8);

	const filtered = React.useMemo(() => {
		const term = search.trim().toLowerCase();
		return devices.filter((d) => {
			if (company !== 'all' && d.companyId !== company) return false;
			if (!term) return true;
			return [d.serialNumber, d.serialDisplay, d.name, d.hawkbitTargetId].some(
				(v) => (v ?? '').toLowerCase().includes(term),
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
					<Link
						href={`/devices/${d.id}`}
						className="font-mono text-xs text-foreground hover:text-primary hover:underline"
					>
						{d.serialDisplay ?? d.serialNumber ?? '—'}
					</Link>
					{d.name && <span className="text-xs text-muted-foreground">{d.name}</span>}
				</div>
			),
		},
		{
			key: 'company',
			header: 'Empresa',
			sortValue: (d) => companyName(d.companyId),
			render: (d) => (
				<span className="text-sm">
					{d.companyId ? (
						<Link
							href={`/companies/${d.companyId}`}
							className="text-foreground hover:text-primary hover:underline"
						>
							{companyName(d.companyId)}
						</Link>
					) : (
						companyName(d.companyId)
					)}
				</span>
			),
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
				<Input
					value={search}
					onChange={(e) => setSearch(e.target.value)}
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
