'use client';
/**
 * Devices — global fleet with cached sources, clickable rows and row-level
 * CRUD. The list reads the shared `devices:admin` cache (same key as ⌘K and
 * the company tabs), so navigating back paints instantly. Rows open the
 * detail Surface from anywhere; quick actions (rename via detail, unlink)
 * sit in the actions column — hidden on phones, where the row tap is the
 * single gesture.
 */

import { Plus } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { HoverCard } from '@/components/arc/hover-card/hover-card';
import type { DataColumn } from '@/components/arc/sortable-data-table/sortable-data-table';
import s from '@/components/arc-app/app.module.css';
import { DeviceDetails } from '@/components/arc-app/details';
import { AssignForm, RegisterForm, RolloutForm } from '@/components/arc-app/forms';
import { Guard, PageHead } from '@/components/arc-app/page-head';
import {
	type AnyRow,
	Button,
	Collection,
	Status,
	Surface,
	stamp,
	Tooltip,
} from '@/components/arc-app/primitives';
import { useAllDeployments } from '@/hooks/use-all-deployments';
import { categoryService, companyService, deviceService, firmwareService } from '@/lib/api';
import { qk } from '@/lib/cache/keys';
import { useQuery } from '@/lib/cache/use-query';

type DeviceForm = {
	kind: 'register' | 'assign' | 'atualização';
	context?: Record<string, unknown>;
};

export default function DevicesPage() {
	const router = useRouter();
	const search = useSearchParams();

	// Shared, cached reads — one request per key across the whole dashboard.
	const devices = useQuery(
		qk.adminDevices,
		React.useCallback(() => deviceService.listAll(), []),
	);
	const companies = useQuery(
		qk.adminCompanies,
		React.useCallback(() => companyService.list(), []),
	);
	const releases = useQuery(
		qk.firmwareReleases,
		React.useCallback(() => firmwareService.list(), []),
		{ sync: false },
	);
	const companyIds = (companies.data?.data ?? []).map((c) => c.id).join(',');
	const groups = useQuery(
		`categories:all:${companyIds}`,
		React.useCallback(
			() =>
				Promise.all(
					companyIds
						.split(',')
						.filter(Boolean)
						.map((cid) =>
							categoryService
								.listByCompany(cid)
								.then((r) => r.data.map((g) => ({ ...g, companyName: '' })))
								.catch(() => []),
						),
				).then((all) => ({ data: all.flat(), total: all.flat().length })),
			[companyIds],
		),
		{ sync: false },
	);

	const { deployments } = useAllDeployments(companies.data?.data ?? []);

	const [selection, setSelection] = React.useState<string[]>([]);
	const [form, setForm] = React.useState<DeviceForm | null>(null);
	const [detail, setDetail] = React.useState<string | null>(search.get('detail'));

	const companyList = companies.data?.data ?? [];
	const deviceList = devices.data?.data ?? [];
	const groupList = groups.data?.data ?? [];
	const device = deviceList.find((d) => d.id === detail) ?? null;

	const rows: AnyRow[] = deviceList.map((d) => ({
		...d,
		company: companyList.find((c) => c.id === d.companyId)?.name ?? 'Sem empresa',
	}));

	const columns: DataColumn<AnyRow>[] = [
		{
			key: 'name',
			label: 'Dispositivo',
			render: (_, r) => (
				<HoverCard
					content={
						<div>
							<strong>{String(r.name)}</strong>
							<p>{String(r.company)}</p>
							<p>Último poll: {r.lastSeenAt ? stamp(String(r.lastSeenAt)) : '—'}</p>
						</div>
					}
				>
					<button type="button" className={s.link} onClick={() => setDetail(String(r.id))}>
						{String(r.name)}
						<span className={`${s.cellSub} ${s.mono}`}>
							{String(r.serialDisplay ?? r.serialNumber ?? '')}
						</span>
					</button>
				</HoverCard>
			),
		},
		{ key: 'company', label: 'Empresa' },
		{ key: 'connectionStatus', label: 'Conexão', render: (v) => <Status value={String(v)} /> },
		{ key: 'status', label: 'Cadastro', render: (v) => <Status value={String(v)} /> },
		{ key: 'firmwareVersion', label: 'Firmware' },
		{
			key: 'lastSeenAt',
			label: 'Última comunicação',
			render: (v) => <span className={s.cellSub}>{v ? stamp(String(v)) : 'sem contato'}</span>,
		},
	];

	return (
		<>
			<PageHead
				title="Dispositivos"
				description="Cadastro, conectividade e vínculos com empresas e grupos."
				actions={
					<Button onClick={() => setForm({ kind: 'register' })}>
						<Plus size={17} />
						Registrar dispositivo
					</Button>
				}
			/>
			<Guard loading={devices.loading} error={devices.error} onRetry={devices.refetch}>
				<section className={s.fabGroup} aria-label="Vinculação de dispositivos">
					<Button
						variant={selection.length ? 'primary' : 'secondary'}
						disabled={!selection.length}
						onClick={() => setForm({ kind: 'assign', context: { deviceIds: selection } })}
					>
						Vincular selecionados ({selection.length})
					</Button>
					<Tooltip content="Procure dispositivos sem empresa para vincular. Também é possível pela empresa ou no detalhe do dispositivo.">
						<Button variant="secondary" onClick={() => setForm({ kind: 'assign' })}>
							Buscar para vincular
						</Button>
					</Tooltip>
				</section>
				<Collection
					label="Dispositivos"
					rows={rows}
					columns={columns}
					onOpenRow={(r) => setDetail(String(r.id))}
					selectable
					selected={selection}
					onSelectionChange={setSelection}
					dateKey="lastSeenAt"
					dateMeaning="Período aplica-se à última comunicação (poll)"
					defaultSortKey="lastSeenAt"
					defaultSortDir="desc"
					fields={[
						{
							id: 'company',
							label: 'Empresa',
							options: ['Sem empresa', ...companyList.map((c) => c.name)],
						},
						{
							id: 'connectionStatus',
							label: 'Conexão',
							options: ['connected', 'disconnected', 'unknown'],
						},
						{
							id: 'status',
							label: 'Cadastro',
							options: ['accepted', 'pending', 'rejected', 'disabled'],
						},
						{
							id: 'firmwareVersion',
							label: 'Firmware',
							options: [
								...new Set(deviceList.map((d) => d.firmwareVersion).filter(Boolean)),
							] as string[],
						},
					]}
				/>
				<p className={s.footnote}>
					O filtro de data e hora consulta o último poll recebido, sem confundir cadastro com
					conectividade.
				</p>
			</Guard>

			<Surface
				open={!!detail}
				onClose={() => {
					setDetail(null);
					if (search.get('detail')) router.replace('/devices');
				}}
				title={device?.name ?? 'Dispositivo'}
				description={device?.serialDisplay ?? device?.serialNumber ?? ''}
			>
				{device && (
					<DeviceDetails
						device={device}
						companies={companyList}
						groups={groupList}
						deployments={deployments}
						onLinkDevice={() => setForm({ kind: 'atualização' })}
					/>
				)}
			</Surface>

			<Surface
				open={!!form}
				onClose={() => setForm(null)}
				title={form?.kind === 'register' ? 'Registrar dispositivo' : 'Vincular dispositivos'}

			>
				{form?.kind === 'register' && (
					<RegisterForm
						companies={companyList}
						groupsByCompany={(cid) => groupList.filter((g) => g.companyId === cid)}
						done={() => setForm(null)}
					/>
				)}
				{form?.kind === 'assign' && (
					<AssignForm
						companies={companyList}
						devices={deviceList}
						groupsByCompany={(cid) => groupList.filter((g) => g.companyId === cid)}
						deviceIds={form.context?.deviceIds as string[] | undefined}
						done={() => setForm(null)}
					/>
				)}
				{form?.kind === 'atualização' && (
					<RolloutForm
						companies={companyList}
						releases={releases.data?.data ?? []}
						devices={deviceList}
						releaseId={form.context?.releaseId as string | undefined}
						done={() => setForm(null)}
					/>
				)}
			</Surface>
		</>
	);
}
