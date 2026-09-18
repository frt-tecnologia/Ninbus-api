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
import { exportToExcel, exportToPdf } from '@/lib/export';
import { firmwareSignal } from '@/lib/design/tokens';
import { formatDateTime } from '@/lib/utils';
import type { FirmwareRelease } from '@/types/domain';
import { Cpu, FileSpreadsheet, FileText, HardDrive, Package } from 'lucide-react';
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from '@/components/ui/empty';
import * as React from 'react';
import { FirmwareGateActions, ReleaseStatusBadge } from './firmware-gate-actions';
import { compareVersionTags } from '@/lib/semver';

/**
 * Factory firmware catalog — chronological list (newest first from the API)
 * with client-side search, type filter, column sort, and export. Reuses the
 * shared <DataTable> primitives exactly like the device/deployment tables.
 */
export function FirmwareTable({
	releases,
	loading,
	error,
	onRetry,
	onDelete,
	onChanged,
}: {
	releases: FirmwareRelease[];
	loading: boolean;
	error: string | null;
	onRetry: () => void;
	onDelete: (release: FirmwareRelease) => void;
	/** Refetch after publish/unpublish (gate actions). */
	onChanged?: () => void;
}) {
	const [search, setSearch] = React.useState('');
	const [type, setType] = React.useState<string>('all');

	const typeLabel = (t: string) =>
		t === 'firmware-ninbus'
			? 'Firmware Ninbus'
			: t === 'firmware-controller'
				? 'Firmware Controlador'
				: t;

	const filtered = React.useMemo(() => {
		const term = search.trim().toLowerCase();
		return releases.filter((r) => {
			if (type !== 'all' && r.artifactType !== type) return false;
			if (!term) return true;
			return [r.name, r.version, r.originalFilename, r.description].some((v) =>
				(v ?? '').toLowerCase().includes(term),
			);
		});
	}, [releases, search, type]);

	const columns: Column<FirmwareRelease>[] = [
		{
			key: 'version',
			header: 'Versão',
			sortValue: (r) => r.version,
			render: (r) => (
				<div className="flex flex-col">
					<div className="flex items-center gap-1.5">
						<Id value={r.version} copy />
						<ReleaseStatusBadge status={r.status} />
					</div>
					{r.name && <span className="text-xs text-muted-foreground">{r.name}</span>}
				</div>
			),
		},
		{
			key: 'type',
			header: 'Tipo',
			sortValue: (r) => r.artifactType,
			render: (r) => (
				<span className="flex items-center gap-1.5 text-sm">
					{r.artifactType === 'firmware-controller' ? (
						<Cpu className="h-3.5 w-3.5 text-muted-foreground" />
					) : (
						<HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
					)}
					{typeLabel(r.artifactType)}
				</span>
			),
		},
		{
			key: 'latest',
			header: 'Mais recente',
			sortValue: (r) =>
				releases.some(
					(o) =>
						o.artifactType === r.artifactType &&
						compareVersionTags(o.version, r.version) > 0,
				)
					? 'superseded'
					: 'latest',
			render: (r) => {
				const superseded = releases.some(
					(o) =>
						o.artifactType === r.artifactType &&
						compareVersionTags(o.version, r.version) > 0,
				);
				return <Signal token={firmwareSignal(superseded ? 'superseded' : 'latest')} size="sm" />;
			},
		},
		{
			key: 'file',
			header: 'Arquivo',
			sortValue: (r) => r.originalFilename ?? '',
			render: (r) => (
				<div className="flex flex-col">
					<span className="font-mono text-xs">{r.originalFilename ?? '—'}</span>
					{r.payloadSize != null && (
						<span className="text-xs text-muted-foreground">
							{(r.payloadSize / 1024).toFixed(0)} KB
							{r.packageSize != null && ` · tar ${(r.packageSize / 1024).toFixed(0)} KB`}
						</span>
					)}
				</div>
			),
		},
		{
			key: 'createdAt',
			header: 'Publicado',
			sortValue: (r) => r.createdAt,
			render: (r) => (
				<div className="flex flex-col">
					<Time value={r.createdAt} />
					<span className="text-xs text-muted-foreground">
						<Relative value={r.createdAt} />
					</span>
				</div>
			),
		},
	];

	const exportCols = [
		{ header: 'Versão', accessor: (r: FirmwareRelease) => r.version },
		{ header: 'Nome', accessor: (r: FirmwareRelease) => r.name },
		{ header: 'Tipo', accessor: (r: FirmwareRelease) => typeLabel(r.artifactType) },
		{ header: 'Arquivo', accessor: (r: FirmwareRelease) => r.originalFilename ?? '—' },
		{
			header: 'Tamanho (KB)',
			accessor: (r: FirmwareRelease) => (r.payloadSize ? Math.round(r.payloadSize / 1024) : '—'),
		},
		{ header: 'Publicado', accessor: (r: FirmwareRelease) => formatDateTime(r.createdAt) },
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
									title: 'Firmware — Ninbus',
									fileName: 'firmware-ninbus',
								})
							}
						>
							<FileText />
							PDF
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() =>
								exportToExcel(filtered, exportCols, {
									fileName: 'firmware-ninbus',
									sheetName: 'Firmware',
								})
							}
						>
							<FileSpreadsheet />
							Excel
						</Button>
					</div>
				}
			>
				<SearchField
					value={search}
					onChange={setSearch}
					placeholder="Buscar por versão, nome, arquivo…"
					className="max-w-xs"
				/>
				<Select value={type} onValueChange={setType}>
					<SelectTrigger className="h-9 w-56">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">Todos os tipos</SelectItem>
						<SelectItem value="firmware-ninbus">Firmware Ninbus</SelectItem>
						<SelectItem value="firmware-controller">Firmware Controlador</SelectItem>
					</SelectContent>
				</Select>
			</Toolbar>

			<DataTable
				columns={columns}
				rows={filtered}
				rowKey={(r) => r.id}
				loading={loading}
				error={error}
				onRetry={onRetry}
				actions={(r) => (
					<FirmwareGateActions release={r} onDelete={onDelete} onChanged={onChanged} />
				)}
				empty={
					<Empty className="py-12">
						<EmptyHeader>
							<div className="flex size-11 items-center justify-center rounded-full border bg-muted">
								<Package className="opacity-60" />
							</div>
							<EmptyTitle>
								{releases.length === 0 ? 'Nenhum firmware no catálogo' : 'Nenhuma release encontrada'}
							</EmptyTitle>
							<EmptyDescription>
								{releases.length === 0
									? 'Use "Enviar firmware" para adicionar a primeira release.'
									: 'Nenhuma release corresponde aos filtros aplicados.'}
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				}
			/>
			<p className="text-xs text-muted-foreground">
				{filtered.length} de {releases.length} releases
			</p>
		</div>
	);
}
