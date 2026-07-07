'use client';

import * as React from 'react';
import Link from 'next/link';
import type { Device } from '@/types/domain';
import { deviceSignal, connectionSignal } from '@/lib/design/tokens';
import { DataTable, type Column } from '@/components/data/data-table';
import { Signal, Id, Relative } from '@/components/system';

/**
 * <CompanyDeviceTable> — the devices of one company, rendered as an organized,
 * scrollable <DataTable> inside the company-detail page. Keeps the signal
 * system (device + connection geometry) and deep-links each device to its
 * detail page. `maxHeight` makes the section scroll independently so a large
 * fleet never blows up the page height.
 */
export function CompanyDeviceTable({
	devices,
	loading,
	error,
	onRetry,
	maxHeight = '32rem',
}: {
	devices: Device[];
	loading: boolean;
	error: string | null;
	onRetry: () => void;
	maxHeight?: string;
}) {
	const [search, setSearch] = React.useState('');
	const filtered = React.useMemo(() => {
		const term = search.trim().toLowerCase();
		if (!term) return devices;
		return devices.filter((d) =>
			[d.name, d.serialNumber, d.serialDisplay, d.hawkbitTargetId].some((v) =>
				(v ?? '').toLowerCase().includes(term),
			),
		);
	}, [devices, search]);

	const columns: Column<Device>[] = [
		{
			key: 'serial',
			header: 'Dispositivo',
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
			key: 'target',
			header: 'Target ID',
			render: (d) => (
				<Id value={d.hawkbitTargetId ?? '—'} className="text-[10px] text-muted-foreground" />
			),
		},
	];

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-2">
				<input
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					placeholder="Buscar por serial, nome, target…"
					className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
				/>
				<span className="text-xs text-muted-foreground">
					{filtered.length} de {devices.length}
				</span>
			</div>
			<div style={{ maxHeight }} className="overflow-auto">
				<DataTable
					columns={columns}
					rows={filtered}
					rowKey={(d) => d.id}
					loading={loading}
					error={error}
					onRetry={onRetry}
					empty={
						<div className="py-10 text-center text-sm text-muted-foreground">
							Nenhum dispositivo vinculado a esta empresa.
						</div>
					}
				/>
			</div>
		</div>
	);
}
