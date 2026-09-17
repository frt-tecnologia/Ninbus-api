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
import { Cpu, FileSpreadsheet, FileText, HardDrive, Package, Trash2 } from 'lucide-react';
import * as React from 'react';

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
}: {
	releases: FirmwareRelease[];
	loading: boolean;
	error: string | null;
	onRetry: () => void;
	onDelete: (release: FirmwareRelease) => void;
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
					<Id value={r.version} copy />
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
							<FileText className="h-4 w-4" />
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
							<FileSpreadsheet className="h-4 w-4" />
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
					<Button
						type="button"
						variant="ghost"
						size="sm"
						title="Excluir release"
						onClick={() => onDelete(r)}
					>
						<Trash2 className="h-4 w-4 text-muted-foreground" />
					</Button>
				)}
				empty={
					<div className="py-12 text-center text-sm text-muted-foreground">
						<Package className="mx-auto mb-2 h-5 w-5 opacity-40" />
						{releases.length === 0
							? 'Nenhum firmware publicado ainda. Use "Enviar firmware".'
							: 'Nenhuma release corresponde aos filtros.'}
					</div>
				}
			/>
			<p className="text-xs text-muted-foreground">
				{filtered.length} de {releases.length} releases
			</p>
		</div>
	);
}

/** Semver compare for the "latest vs superseded" column (mirrors the API). */
function compareVersionTags(a: string, b: string): number {
	const pa = /^(\d+)\.(\d+)\.(\d+)(?:[-+]([0-9A-Za-z.-]+))?$/.exec(a.trim());
	const pb = /^(\d+)\.(\d+)\.(\d+)(?:[-+]([0-9A-Za-z.-]+))?$/.exec(b.trim());
	if (!pa || !pb) return a.localeCompare(b);
	for (let i = 1; i <= 3; i++) {
		const diff = Number(pa[i]) - Number(pb[i]);
		if (diff !== 0) return diff;
	}
	if (!pa[4] && !pb[4]) return 0;
	if (!pa[4]) return 1;
	if (!pb[4]) return -1;
	return pa[4].localeCompare(pb[4] ?? '');
}
