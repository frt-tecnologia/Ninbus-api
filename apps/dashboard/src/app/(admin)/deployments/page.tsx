'use client';
/**
 * Deployments — one screen, two tabs: Atualizações (charts + collection + the
 * per-device detail Surface, deep-linked by ?detail=&company=) and Firmware
 * (release catalog + publish drawer). Merging keeps a single domain context
 * (Eixo D) and lets both tabs share the cached companies/devices/releases
 * reads. Old routes `/deployments/…` and `/deployments/firmware` redirect
 * here with the same params.
 */

import { Plus, Upload } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { BarChart } from '@/components/arc/bar-chart/bar-chart';
import { DonutChart } from '@/components/arc/donut-chart/donut-chart';
import { Progress } from '@/components/arc/progress/progress';
import type { DataColumn } from '@/components/arc/sortable-data-table/sortable-data-table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs';
import s from '@/components/arc-app/app.module.css';
import { ReleaseDetails, RolloutDetails } from '@/components/arc-app/details';
import { ReleaseForm, RolloutForm } from '@/components/arc-app/forms';
import { Guard, PageHead } from '@/components/arc-app/page-head';
import {
	type AnyRow,
	Button,
	Collection,
	kindOptions,
	Panel,
	type Period,
	Status,
	Surface,
	stamp,
} from '@/components/arc-app/primitives';
import { useAllDeployments } from '@/hooks/use-all-deployments';
import { companyService, deviceService, firmwareService } from '@/lib/api';
import { qk } from '@/lib/cache/keys';
import { useQuery } from '@/lib/cache/use-query';
import { resolvePeriod } from '@/lib/time/period';

const STATES = ['completed', 'in_progress', 'pending', 'failed', 'canceled'] as const;
const STATE_LABEL: Record<string, string> = {
	completed: 'Concluído',
	in_progress: 'Em andamento',
	pending: 'Pendente',
	failed: 'Falha',
	canceled: 'Cancelado',
};

export default function DeploymentsPage() {
	const router = useRouter();
	const search = useSearchParams();
	const tab = search.get('tab') === 'firmware' ? 'firmware' : 'atualizações';

	const companies = useQuery(
		qk.adminCompanies,
		React.useCallback(() => companyService.list(), []),
	);
	const devices = useQuery(
		qk.adminDevices,
		React.useCallback(() => deviceService.listAll(), []),
		{ sync: false },
	);
	const releases = useQuery(
		qk.firmwareReleases,
		React.useCallback(() => firmwareService.list(), []),
	);
	const companyList = companies.data?.data ?? [];
	const { deployments, loading, error } = useAllDeployments(companyList);

	// Detail surfaces — deep-linked (?detail= + ?company= for atualizações).
	const [rolloutForm, setRolloutForm] = React.useState(false);
	const [upload, setUpload] = React.useState(search.get('upload') === '1');
	const [releaseDetail, setReleaseDetail] = React.useState<string | null>(search.get('detail'));
	const [deployFor, setDeployFor] = React.useState<string | null>(null);
	const [rolloutDetail, setRolloutDetail] = React.useState<{
		companyId: string;
		id: string;
	} | null>(
		search.get('detail') && search.get('company') && tab === 'atualizações'
			? { companyId: search.get('company') as string, id: search.get('detail') as string }
			: null,
	);

	const openRollout = (companyId: string | undefined, id: string) =>
		setRolloutDetail({ companyId: companyId ?? '', id: String(id) });
	const deployment = rolloutDetail
		? (deployments.find(
				(d) => String(d.id) === rolloutDetail.id && d.companyId === rolloutDetail.companyId,
			) ?? null)
		: null;
	const releaseList = releases.data?.data ?? [];
	const release = releaseList.find((r) => r.id === releaseDetail) ?? null;

	// ── Atualizações tab ───────────────────────────────────────────────────

	const [chartStatus, setChartStatus] = React.useState<string | null>(null);
	const [period, setPeriod] = React.useState<Period | null>(null);

	const rows: AnyRow[] = deployments.map((r) => ({
		...r,
		id: String(r.id),
		company: companyList.find((c) => c.id === r.companyId)?.name ?? '',
		done: r.statistics?.finished ?? 0,
		targets: r.statistics?.totalTargets ?? 0,
		failed: r.statistics?.failed ?? 0,
	}));

	const anchor = Math.max(
		Date.now(),
		...deployments.map((r) => new Date(r.createdAt ?? 0).getTime() || 0),
	);
	const resolved = period ? resolvePeriod(period) : null;
	const start = resolved ? resolved.from.getTime() : anchor - 30 * 24 * 3600_000;
	const end = resolved ? resolved.to.getTime() : anchor;
	const inWindow = rows.filter((r) => {
		const t = new Date((r as { createdAt?: number }).createdAt ?? 0).getTime() || 0;
		return t >= start && t <= end;
	});
	const chart = Array.from({ length: 12 }, (_, i) => {
		const lo = start + (end - start) * (i / 12);
		const hi = start + (end - start) * ((i + 1) / 12);
		return {
			key: `bucket${i}`,
			label: new Date(lo).toLocaleString('pt-BR', {
				timeZone: 'America/Recife',
				month: 'short',
				day: '2-digit',
				hour: '2-digit',
			}),
			value: inWindow.filter((r) => {
				const t = new Date((r as { createdAt?: number }).createdAt ?? 0).getTime() || 0;
				return t >= lo && (i === 11 ? t <= hi : t < hi);
			}).length,
		};
	});

	const columns: DataColumn<AnyRow>[] = [
		{
			key: 'name',
			label: 'Atualização',
			render: (_, r) => (
				<button
					type="button"
					className={s.link}
					onClick={() => openRollout(r.companyId, String(r.id))}
				>
					{String(r.displayName ?? r.name)}
					<span className={s.cellSub}>{String(r.typeName ?? r.type ?? '')}</span>
				</button>
			),
		},
		{ key: 'company', label: 'Empresa' },
		{ key: 'status', label: 'Estado', render: (v) => <Status value={String(v)} /> },
		{
			key: 'done',
			label: 'Progresso',
			render: (_, r) => (
				<div className={s.progressCell}>
					<span>
						{String(r.done)} / {String(r.targets)}
					</span>
					<Progress
						value={Number(r.done)}
						max={Number(r.targets)}
						aria-label="Progresso da atualização"
					/>
				</div>
			),
		},
		{
			key: 'failed',
			label: 'Falhas',
			render: (v) => <span className={Number(v) ? s.bad : s.muted}>{String(v)}</span>,
		},
	];

	// ── Firmware tab ───────────────────────────────────────────────────

	const releaseColumns: DataColumn<AnyRow>[] = [
		{
			key: 'name',
			label: 'Release',
			render: (_, r) => (
				<button type="button" className={s.link} onClick={() => setReleaseDetail(String(r.id))}>
					{String(r.name)} · {String(r.version)}
					<span className={s.cellSub}>{String(r.originalFilename ?? '')}</span>
				</button>
			),
		},
		{
			key: 'artifactType',
			label: 'Tipo',
			render: (v) => kindOptions.find((k) => k.value === v)?.label ?? String(v),
		},
		{ key: 'status', label: 'Estado', render: (v) => <Status value={String(v)} /> },
		{
			key: 'payloadSize',
			label: 'Tamanho',
			render: (v) => (v ? `${(Number(v) / 1024).toFixed(1)} KB` : '—'),
		},
		{ key: 'createdAt', label: 'Publicada em', render: (v) => stamp(String(v)) },
	];

	return (
		<>
			<PageHead
				title="Atualizações"
				description="Atualizações, firmware e arquivos NFX — o ciclo completo de atualização."
				actions={
					<>
						<Button onClick={() => setRolloutForm(true)}>
							<Plus size={17} />
							Nova atualização
						</Button>
						<Button variant="secondary" onClick={() => setUpload(true)}>
							<Upload size={17} />
							Publicar release
						</Button>
					</>
				}
			/>
			<Tabs defaultValue={tab}>
				<TabsList aria-label="Domínio de deployments">
					<TabsTrigger value="atualizações">Atualizações</TabsTrigger>
					<TabsTrigger value="firmware">Firmware</TabsTrigger>
				</TabsList>

				<TabsContent value="atualizações">
					<Guard loading={loading || companies.loading} error={companies.error ?? error}>
						<div className={s.rolloutSummary}>
							<Panel
								title="Estados das atualizações"
								description="Selecione uma categoria para filtrar a lista"
							>
								<DonutChart
									label="Estados dos atualizações"
									size={176}
									totalLabel="Atualizações"
									legendAction="select"
									activeKey={chartStatus}
									onActiveChange={setChartStatus}
									data={STATES.map((status, i) => ({
										key: status,
										label: STATE_LABEL[status],
										value: deployments.filter((r) => r.status === status).length,
										color: [
											'var(--success)',
											'var(--accent)',
											'var(--text-muted)',
											'var(--danger)',
											'var(--text-secondary)',
										][i],
									}))}
								/>
							</Panel>
							<Panel
								title="Atualizações criadas"
								description={period ? 'Período personalizado' : 'Últimos 30 dias'}
							>
								<BarChart
									label="Atualizações por intervalo"
									data={chart}
									period="30d"
									averageLabel="Média por intervalo"
									categoryLabel="Intervalo"
									valueLabel="Atualizações"
								/>
							</Panel>
						</div>
						{chartStatus && (
							<div className={s.inline}>
								<Status value={chartStatus} />
								<Button variant="ghost" onClick={() => setChartStatus(null)}>
									Mostrar todos os estados
								</Button>
							</div>
						)}
						<Collection
							label="Atualizações"
							rows={rows.filter((r) => !chartStatus || r.status === chartStatus)}
							columns={columns}
							onOpenRow={(r) => openRollout(String(r.companyId ?? ''), String(r.id))}
							dateKey="createdAt"
							dateMeaning="Período aplica-se à criação da atualização"
                            period={period}
                            onPeriodChange={setPeriod}
							fields={[
								{ id: 'company', label: 'Empresa', options: companyList.map((c) => c.name) },
								{
									id: 'status',
									label: 'Estado',
									options: STATES.map((v) => ({ value: v, label: STATE_LABEL[v] })),
								},
							]}
						/>
					</Guard>
				</TabsContent>

				<TabsContent value="firmware">
					<Guard loading={releases.loading} error={releases.error} onRetry={releases.refetch}>
						<Collection
							label="Releases e arquivos NFX"
							rows={releaseList.map((r) => ({ ...r }))}
							columns={releaseColumns}
							onOpenRow={(r) => setReleaseDetail(String(r.id))}
							dateKey="createdAt"
							fields={[
								{
									id: 'artifactType',
									label: 'Tipo',
									options: kindOptions.map((k) => ({ value: k.value, label: k.label })),
								},
								{ id: 'status', label: 'Estado', options: ['published', 'draft'] },
							]}
						/>
					</Guard>
				</TabsContent>
			</Tabs>

			{/* Atualização detail — in place, no navigation */}
			<Surface
				open={!!rolloutDetail && !!deployment}
				onClose={() => {
					setRolloutDetail(null);
					if (search.get('detail') && search.get('company')) router.replace('/deployments');
				}}
				title={deployment?.displayName ?? deployment?.name ?? 'Atualização'}
				description={deployment?.typeName ?? undefined}
			>
				{deployment && rolloutDetail && (
					<RolloutDetails
						companyId={rolloutDetail.companyId}
						deployment={deployment}
						openDevice={(id) => router.push(`/devices?detail=${id}`)}
						onDone={() => {
							setRolloutDetail(null);
							if (search.get('detail')) router.replace('/deployments');
						}}
					/>
				)}
			</Surface>

			{/* New atualização */}
			<Surface
				open={rolloutForm}
				onClose={() => setRolloutForm(false)}
				title="Preparar deploy"
				description="A atualização é criada no serviço de distribuição e entregue no próximo contato de cada dispositivo."
			>
				<RolloutForm
					companies={companyList}
					releases={releaseList}
					devices={devices.data?.data ?? []}
					done={() => setRolloutForm(false)}
				/>
			</Surface>

			{/* Publish release */}
			<Surface
				open={upload}
				onClose={() => {
					setUpload(false);
					if (search.get('upload')) router.replace('/deployments?tab=firmware');
				}}
				title="Publicar release"
				description="O upload começa ao selecionar o arquivo; a publicação exige confirmação do servidor."
			>
				<ReleaseForm done={() => setUpload(false)} />
			</Surface>

			{/* Release detail */}
			<Surface
				open={!!releaseDetail && tab === 'firmware'}
				onClose={() => {
					setReleaseDetail(null);
					if (search.get('detail')) router.replace('/deployments?tab=firmware');
				}}
				title={release ? `${release.name} · ${release.version}` : 'Release'}
				description="Revise antes de distribuir."
			>
				{release && <ReleaseDetails release={release} onDeploy={() => setDeployFor(release.id)} />}
			</Surface>

			{/* Deploy a specific release */}
			<Surface
				open={!!deployFor}
				onClose={() => setDeployFor(null)}
				title="Preparar deploy desta release"
				description="A atualização é criada no serviço de distribuição e entregue no próximo contato de cada dispositivo."
			>
				{deployFor && (
					<RolloutForm
						companies={companyList}
						releases={releaseList}
						devices={devices.data?.data ?? []}
						releaseId={deployFor}
						done={() => setDeployFor(null)}
					/>
				)}
			</Surface>
		</>
	);
}
