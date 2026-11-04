'use client';
/**
 * Overview — platform health at a glance. Progressive rendering (A1/A4):
 * the page paints immediately and each section fills as its data lands —
 * no Promise.all gate. Reads the SAME cached collections as the other
 * screens (companies/devices/users/deployments), so a visit here warms the
 * cache for everything else and revisits are instant.
 */
import { ArrowUpRight, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import {
	type ActivityDay,
	ActivityHeatmap,
} from '@/components/arc/activity-heatmap/activity-heatmap';
import { DonutChart } from '@/components/arc/donut-chart/donut-chart';
import { LineChart } from '@/components/arc/line-chart/line-chart';
import { MetricCard } from '@/components/arc/metric-card/metric-card';
import { Progress } from '@/components/arc/progress/progress';
import { Skeleton } from '@/components/arc/skeleton/skeleton';
import type { DataColumn } from '@/components/arc/sortable-data-table/sortable-data-table';
import { Timeline, type TimelineEvent } from '@/components/arc/timeline/timeline';
import s from '@/components/arc-app/app.module.css';
import { Guard, PageHead } from '@/components/arc-app/page-head';
import { PeriodPills } from '@/components/arc-app/period-controls';
import { PollingPanel } from '@/components/arc-app/polling-panel';
import { type AnyRow, Button, Collection, Panel, Status } from '@/components/arc-app/primitives';
import { useAllDeployments } from '@/hooks/use-all-deployments';
import {
	companyService,
	designationService,
	deviceService,
	firmwareService,
	observabilityService,
	userService,
} from '@/lib/api';
import { qk } from '@/lib/cache/keys';
import { useQuery } from '@/lib/cache/use-query';
import { type Period, periodKey as periodKeyOf, resolvePeriod } from '@/lib/time/period';
import type { EnrichedDeployment } from '@/types/domain';

const DEPLOY_LABEL: Record<string, string> = {
	pending: 'Pendente',
	in_progress: 'Em andamento',
	completed: 'Concluído',
	failed: 'Falha',
	canceled: 'Cancelado',
	no_targets: 'Sem alvos',
};

export default function OverviewPage() {
	const router = useRouter();

	// Shared cached reads — identical keys to the dedicated screens.
	const companies = useQuery(
		qk.adminCompanies,
		React.useCallback(() => companyService.list(), []),
	);
	const devices = useQuery(
		qk.adminDevices,
		React.useCallback(() => deviceService.listAll(), []),
	);
	const users = useQuery(
		qk.adminUsers,
		React.useCallback(() => userService.list(), []),
	);
	const invites = useQuery(
		qk.adminInvites,
		React.useCallback(() => designationService.listPending(), []),
	);
	const latest = useQuery(
		qk.latestRelease('firmware-ninbus'),
		React.useCallback(() => firmwareService.latest('firmware-ninbus'), []),
	);
	const activity = useQuery(
		qk.adminActivity,
		React.useCallback(() => observabilityService.activity({ limit: 6 }), []),
	);
	const heat = useQuery(
		'activity:heat:30d',
		React.useCallback(
			() =>
				observabilityService.activity({
					limit: 200,
					from: new Date(Date.now() - 30 * 86_400_000),
					to: new Date(),
				}),
			[],
		),
	);

	const companyList = companies.data?.data ?? [];
	const deviceList = devices.data?.data ?? [];
	const { deployments, loading: depLoading, error: depError } = useAllDeployments(companyList);

	const [period, setPeriod] = React.useState<Period | null>({ kind: 'relative', preset: '30d' });
	const [heatDay, setHeatDay] = React.useState<string | null>(null);

	// Real series from the API: assignment events + confirmed terminal outcomes.
	const timelineBuckets =
		period?.kind === 'relative' ? { '1h': 12, '24h': 24, '7d': 28, '30d': 30 }[period.preset] : 30;
	const periodFrom = period ? resolvePeriod(period).from : null;
	const periodTo = period ? resolvePeriod(period).to : null;
	const timeline = useQuery(
		`timeline:${period ? periodKeyOf(period) : 'none'}`,
		React.useCallback(
			() =>
				periodFrom && periodTo
					? observabilityService.deploymentTimeline({
							from: periodFrom,
							to: periodTo,
							buckets: timelineBuckets,
						})
					: Promise.resolve(null),
			[timelineBuckets, periodFrom, periodTo],
		),
	);

	const online = deviceList.filter((d) =>
		['online', 'connected'].includes(d.connectionStatus ?? ''),
	).length;
	const active = deployments.filter((d) => ['pending', 'in_progress'].includes(d.status));
	const failedTargets = deployments.reduce((sum, d) => sum + (d.statistics?.failed ?? 0), 0);
	const totalTargets = deployments.reduce((sum, d) => sum + (d.statistics?.totalTargets ?? 0), 0);

	const chart = React.useMemo(() => {
		const data = timeline.data?.data ?? [];
		return data.map((b, i) => ({
			key: `bucket${i}`,
			label: new Date(b.start).toLocaleString('pt-BR', {
				timeZone: 'America/Sao_Paulo',
				month: 'short',
				day: '2-digit',
				hour: '2-digit',
				minute: '2-digit',
			}),
			axisLabel: i % Math.ceil(data.length / 6) === 0 ? undefined : undefined,
			values: { assigned: b.assigned, installed: b.installed },
		}));
	}, [timeline.data]);
	const timelineTotals = React.useMemo(() => {
		const data = timeline.data?.data ?? [];
		return data.reduce(
			(acc, b) => ({
				assigned: acc.assigned + b.assigned,
				installed: acc.installed + b.installed,
				failed: acc.failed + b.failed,
				canceled: acc.canceled + b.canceled,
			}),
			{ assigned: 0, installed: 0, failed: 0, canceled: 0 },
		);
	}, [timeline.data]);

	// "Frota na última versão" — devices reporting the latest factory release.
	const latestVersion = latest.data?.data?.version ?? null;
	const onLatest = latestVersion
		? deviceList.filter((d) => d.firmwareVersion === latestVersion).length
		: 0;

	const heatDays: ActivityDay[] = React.useMemo(() => {
		const rows = heat.data?.data ?? [];
		if (!rows.length) return [];
		const byDay = new Map<string, number>();
		for (const e of rows) {
			const day = new Date(e.createdAt).toLocaleDateString('sv-SE', {
				timeZone: 'America/Sao_Paulo',
			});
			byDay.set(day, (byDay.get(day) ?? 0) + 1);
		}
		const days = [...byDay.keys()].sort();
		const out: ActivityDay[] = [];
		// Coverage starts at the first recorded day — earlier days are unknown, not zero.
		for (
			let d = new Date(`${days[0]}T12:00:00Z`);
			d <= new Date();
			d = new Date(d.getTime() + 86_400_000)
		) {
			const key = d.toISOString().slice(0, 10);
			out.push({ date: key, count: byDay.get(key) ?? 0 });
		}
		return out;
	}, [heat.data]);
	const dayEvents = React.useMemo(() => {
		if (!heatDay) return null;
		return (heat.data?.data ?? []).filter(
			(e) =>
				new Date(e.createdAt).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) ===
				heatDay,
		);
	}, [heatDay, heat.data]);

	const events: TimelineEvent[] = (activity.data?.data ?? []).map((e) => ({
		id: String(e.id),
		at: e.createdAt,
		actor: e.actorEmail ?? undefined,
		title: `${e.action}${e.entityLabel ? ` · ${e.entityLabel}` : ''}`,
		meta: e.entityType,
	}));

	const rolloutColumns: DataColumn<AnyRow>[] = [
		{
			key: 'name',
			label: 'Atualização',
			render: (_, r) => (
				<button
					type="button"
					className={s.link}
					onClick={() => router.push(`/deployments?detail=${r.id}&company=${r.companyId}`)}
				>
					{String(r.displayName)}
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

	const rolloutRows = deployments.map((r: EnrichedDeployment) => ({
		...r,
		id: String(r.id),
		company: companyList.find((c) => c.id === r.companyId)?.name ?? '',
		done: r.statistics?.finished ?? 0,
		targets: r.statistics?.totalTargets ?? 0,
		failed: r.statistics?.failed ?? 0,
	}));

	const fleetLoading = companies.loading || devices.loading;

	return (
		<>
			<PageHead
				title="Visão geral"
				description="Saúde da frota e atualizações que precisam de atenção."
				actions={
					<Button onClick={() => router.push('/deployments?tab=firmware&upload=1')}>
						<Plus size={17} />
						Publicar release
					</Button>
				}
			/>
			<div className={s.overviewToolbar}>
				<span className={s.footnote}>
					Conexão inferida pelos polls do serviço de atualizações · estado atual, não histórico
				</span>
				<PeriodPills value={period} onChange={setPeriod} />
			</div>

			{/* Metrics paint as each collection lands — no full-page gate. */}
			<div className={s.metrics}>
				{fleetLoading ? (
					<Skeleton lines={3} label="Carregando frota" />
				) : (
					<MetricCard
						label="Dispositivos"
						value={deviceList.length}
						context={`${online} conectados · ${deviceList.length - online} inativos`}
					/>
				)}
				{companies.loading ? (
					<Skeleton lines={3} label="Carregando empresas" />
				) : (
					<MetricCard
						label="Empresas"
						value={companyList.length}
						context={`${companyList.filter((c) => c.status === 'active').length} com operação ativa`}
					/>
				)}
				{users.loading ? (
					<Skeleton lines={3} label="Carregando pessoas" />
				) : (
					<MetricCard
						label="Pessoas"
						value={users.data?.data.length ?? 0}
						context={`${invites.data?.data.length ?? 0} convites pendentes`}
					/>
				)}
				{depLoading ? (
					<Skeleton lines={3} label="Carregando atualizações" />
				) : (
					<MetricCard
						label="Atualizações ativas"
						value={active.length}
						context={`${totalTargets} dispositivos alvo`}
					/>
				)}
			</div>

			{!depLoading && failedTargets > 0 && (
				<button type="button" className={s.attention} onClick={() => router.push('/deployments')}>
					<span>
						<span className={s.errorMark}>!</span>
						<strong>{failedTargets} falhas registradas</strong>
						<span> · Consulte o resultado por dispositivo</span>
					</span>
					<span className={s.attentionLink}>
						Investigar <ArrowUpRight size={16} />
					</span>
				</button>
			)}

			<div className={s.chartGrid}>
				<Panel
					title="Atividade de atualizações"
					description="Atribuições criadas e instalações concluídas no período (eventos por intervalo)"
				>
					{timeline.loading && !timeline.data ? (
						<Skeleton lines={5} label="Carregando atividade de atualizações" />
					) : (
						<>
							<LineChart
								label="Atualizações no período"
								data={chart}
								series={[
									{ key: 'assigned', label: 'Atribuições', color: 'var(--accent)' },
									{ key: 'installed', label: 'Instalações concluídas', color: 'var(--success)' },
								]}
								categoryLabel="Intervalo"
								emptyLabel="Nenhuma atualização no período"
							/>
							<div className={s.chartFoot}>
								<span>
									{timelineTotals.assigned} atribuições · {timelineTotals.installed} instalações ·{' '}
									{timelineTotals.failed} falhas · {timelineTotals.canceled} cancelamentos
								</span>
								<span>Horário de Brasília</span>
							</div>
						</>
					)}
				</Panel>
				<Panel title="Conexão da frota" description="Estado recebido no último snapshot">
					{devices.loading ? (
						<Skeleton lines={5} label="Carregando conexão da frota" />
					) : (
						<>
							<DonutChart
								label="Conexão dos dispositivos"
								totalLabel="Frota total"
								unit="dispositivos"
								size={176}
								thickness={18}
								data={[
									{ key: 'connected', label: 'Conectados', value: online, color: 'var(--success)' },
									{
										key: 'offline',
										label: 'Inativos',
										value: deviceList.length - online,
										color: 'var(--text-muted)',
									},
								]}
							/>
							{latestVersion && (
								<p className={s.footnote}>
									{onLatest} de {deviceList.length} na versão {latestVersion}.
								</p>
							)}
						</>
					)}
				</Panel>
			</div>

			<PollingPanel />

			<Panel title="Atualizações" description="Busca, filtros e ordenação aplicados aos registros">
				<Guard
					loading={depLoading}
					error={depError}
					empty={!rolloutRows.length}
					emptyTitle="Nenhuma atualização"
				>
					<Collection
						rows={rolloutRows}
						columns={rolloutColumns}
						label="Atualizações"
						onOpenRow={(r) => router.push(`/deployments?detail=${r.id}&company=${r.companyId}`)}
						dateKey="createdAt"
						period={period}
						onPeriodChange={setPeriod}
						fields={[
							{ id: 'company', label: 'Empresa', options: companyList.map((c) => c.name) },
							{
								id: 'status',
								label: 'Estado',
								options: Object.entries(DEPLOY_LABEL).map(([value, label]) => ({ value, label })),
							},
						]}
					/>
				</Guard>
			</Panel>

			<div className={s.lowerGrid}>
				<Panel
					title="Frota por empresa"
					description="Dispositivos vinculados e firmware atualizado"
				>
					{companies.loading || devices.loading ? (
						<Skeleton lines={4} label="Carregando frota por empresa" />
					) : (
						<div className={s.companyProgress}>
							{companyList.slice(0, 6).map((c) => {
								const ds = deviceList.filter((d) => d.companyId === c.id);
								const updated = latestVersion
									? ds.filter((d) => d.firmwareVersion === latestVersion).length
									: 0;
								return (
									<button
										type="button"
										key={c.id}
										onClick={() => router.push(`/companies/${c.id}`)}
									>
										<div>
											<span>{c.name}</span>
											<span>
												{updated} / {ds.length}
											</span>
										</div>
										<Progress value={updated} max={Math.max(1, ds.length)} aria-label={c.name} />
										<small>
											{ds.length} dispositivos
											<span>
												{latestVersion ? `na versão ${latestVersion}` : 'sem release publicada'}
											</span>
										</small>
									</button>
								);
							})}
							{companyList.length > 6 && (
								<Button variant="ghost" onClick={() => router.push('/companies')}>
									Ver todas as {companyList.length} empresas <ArrowUpRight size={15} />
								</Button>
							)}
						</div>
					)}
				</Panel>
				<Panel
					title="Atividade recente"
					description="Eventos de auditoria agregados por dia (últimos 30 dias). Selecione um dia para ver os eventos."
					action={
						<Button variant="ghost" onClick={() => router.push('/audit')}>
							Ver histórico
						</Button>
					}
				>
					{heat.loading && !heat.data ? (
						<Skeleton lines={6} label="Carregando atividade" />
					) : heatDays.length ? (
						<>
							<ActivityHeatmap
								days={heatDays}
								label="Atividade por dia"
								period="nos últimos 30 dias"
								unit={{ one: 'evento', other: 'eventos' }}
								locale="pt-BR"
								selectedDate={heatDay}
								onSelectDate={(d) => setHeatDay(d === heatDay ? null : d)}
							/>
							{heatDay ? (
								<div className={s.formStack}>
									<button type="button" className={s.link} onClick={() => setHeatDay(null)}>
										Limpar dia selecionado
									</button>
									{dayEvents?.length ? (
										<Timeline
											events={dayEvents.map((e) => ({
												id: String(e.id),
												at: e.createdAt,
												actor: e.actorEmail ?? undefined,
												title: `${e.action}${e.entityLabel ? ` · ${e.entityLabel}` : ''}`,
												meta: e.entityType,
											}))}
											now={Date.now()}
											label={`Eventos de ${heatDay}`}
											locale="pt-BR"
											timeZone="America/Sao_Paulo"
											scrollToNew={false}
										/>
									) : (
										<p className={s.footnote}>Nenhum evento registrado neste dia.</p>
									)}
								</div>
							) : (
								<Timeline
									events={events}
									now={Date.now()}
									label="Atividade recente"
									locale="pt-BR"
									timeZone="America/Sao_Paulo"
									scrollToNew={false}
								/>
							)}
						</>
					) : (
						<p className={s.footnote}>
							Sem eventos registrados ainda — a cobertura começa com o primeiro evento.
						</p>
					)}
				</Panel>
			</div>
		</>
	);
}
