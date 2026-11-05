'use client';

import { ArrowUpRight } from 'lucide-react';
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
import { Timeline } from '@/components/arc/timeline/timeline';
import s from '@/components/arc-app/app.module.css';
import { Guard, PageHead } from '@/components/arc-app/page-head';
import { PeriodPills } from '@/components/arc-app/period-controls';
import { type AnyRow, Button, Collection, Panel, Status } from '@/components/arc-app/primitives';
import { useOverview } from '@/hooks/use-overview';

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
	const overview = useOverview();

	const deploymentColumns: DataColumn<AnyRow>[] = [
		{
			key: 'displayName',
			label: 'Atualização',
			render: (_, r) => (
				<button
					type="button"
					className={s.link}
					onClick={() => router.push(`/deployments?detail=${r.id}&company=${r.companyId}`)}
				>
					{String(r.displayName)}
					<span className={s.cellSub}>{String(r.typeName ?? '')}</span>
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

	const fleetLoading = overview.companies.loading || overview.devices.loading;
	const deviceTotal = overview.devices.list.length;

	return (
		<>
			<PageHead
				title="Visão geral"
				description="Saúde da frota e atualizações que precisam de atenção."
			/>
			<div className={s.overviewToolbar}>
				<span className={s.footnote}>
					Conexão inferida pelos polls do serviço de atualizações · estado atual, não histórico
				</span>
				<PeriodPills value={overview.period} onChange={overview.setPeriod} />
			</div>

			<div className={s.metrics}>
				{fleetLoading ? (
					<Skeleton lines={3} label="Carregando frota" />
				) : (
					<MetricCard
						label="Dispositivos"
						value={deviceTotal}
						context={`${overview.online} conectados · ${deviceTotal - overview.online} inativos`}
					/>
				)}
				{overview.companies.loading ? (
					<Skeleton lines={3} label="Carregando empresas" />
				) : (
					<MetricCard
						label="Empresas"
						value={overview.companies.list.length}
						context={`${overview.companies.list.filter((c) => c.status === 'active').length} com operação ativa`}
					/>
				)}
				{overview.users.loading ? (
					<Skeleton lines={3} label="Carregando pessoas" />
				) : (
					<MetricCard
						label="Pessoas"
						value={overview.users.count}
						context={`${overview.invites.count} convites pendentes`}
					/>
				)}
				{overview.deployments.loading ? (
					<Skeleton lines={3} label="Carregando atualizações" />
				) : (
					<MetricCard
						label="Atualizações ativas"
						value={overview.deployments.active.length}
						context={`${overview.deployments.totalTargets} dispositivos alvo`}
					/>
				)}
			</div>

			{!overview.deployments.loading && overview.deployments.failedTargets > 0 && (
				<button type="button" className={s.attention} onClick={() => router.push('/deployments')}>
					<span>
						<span className={s.errorMark}>!</span>
						<strong>{overview.deployments.failedTargets} falhas registradas</strong>
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
					{overview.timeline.loading && !overview.timeline.hasData ? (
						<Skeleton lines={5} label="Carregando atividade de atualizações" />
					) : (
						<>
							<LineChart
								label="Atualizações no período"
								data={overview.timeline.chart}
								series={[
									{ key: 'assigned', label: 'Atribuições', color: 'var(--accent)' },
									{ key: 'installed', label: 'Instalações concluídas', color: 'var(--success)' },
								]}
								categoryLabel="Intervalo"
								emptyLabel="Nenhuma atualização no período"
							/>
							<div className={s.chartFoot}>
								<span>
									{overview.timeline.totals.assigned} atribuições ·{' '}
									{overview.timeline.totals.installed} instalações ·{' '}
									{overview.timeline.totals.failed} falhas · {overview.timeline.totals.canceled}{' '}
									cancelamentos
								</span>
								<span>Horário de Brasília</span>
							</div>
						</>
					)}
				</Panel>
				<Panel title="Conexão da frota" description="Estado recebido no último snapshot">
					{overview.devices.loading ? (
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
									{
										key: 'connected',
										label: 'Conectados',
										value: overview.online,
										color: 'var(--success)',
									},
									{
										key: 'offline',
										label: 'Inativos',
										value: deviceTotal - overview.online,
										color: 'var(--text-muted)',
									},
								]}
							/>
							{overview.fleet.latestVersion && (
								<p className={s.footnote}>
									{overview.fleet.onLatest} de {deviceTotal} na versão{' '}
									{overview.fleet.latestVersion}.
								</p>
							)}
						</>
					)}
				</Panel>
			</div>

			<Panel title="Atualizações" description="Busca, filtros e ordenação aplicados aos registros">
				<Guard
					loading={overview.deployments.loading}
					error={overview.deployments.error}
					empty={!overview.deployments.rows.length}
					emptyTitle="Nenhuma atualização"
				>
					<Collection
						rows={overview.deployments.rows}
						columns={deploymentColumns}
						label="Atualizações"
						onOpenRow={(r) => router.push(`/deployments?detail=${r.id}&company=${r.companyId}`)}
						dateKey="createdAt"
						showPeriodFilter={false}
						period={overview.period}
						onPeriodChange={overview.setPeriod}
						fields={[
							{
								id: 'company',
								label: 'Empresa',
								options: overview.companies.list.map((c) => c.name),
							},
							{
								id: 'status',
								label: 'Estado',
								options: Object.entries(DEPLOY_LABEL).map(([value, label]) => ({
									value,
									label,
								})),
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
					{fleetLoading ? (
						<Skeleton lines={4} label="Carregando frota por empresa" />
					) : (
						<div className={s.companyProgress}>
							{overview.fleet.byCompany.map((c) => (
								<button type="button" key={c.id} onClick={() => router.push(`/companies/${c.id}`)}>
									<div>
										<span>{c.name}</span>
										<span>
											{c.updated} / {c.devices}
										</span>
									</div>
									<Progress value={c.updated} max={Math.max(1, c.devices)} aria-label={c.name} />
									<small>
										{c.devices} dispositivos
										<span>
											{overview.fleet.latestVersion
												? `na versão ${overview.fleet.latestVersion}`
												: 'sem release publicada'}
										</span>
									</small>
								</button>
							))}
							{overview.fleet.totalCompanies > overview.fleet.byCompany.length && (
								<Button variant="ghost" onClick={() => router.push('/companies')}>
									Ver todas as {overview.fleet.totalCompanies} empresas <ArrowUpRight size={15} />
								</Button>
							)}
						</div>
					)}
				</Panel>
				<Panel
					title="Atividade recente"
					description="Eventos de auditoria agregados por dia no último ano. Selecione um dia para ver os eventos."
					action={
						<Button variant="ghost" onClick={() => router.push('/audit')}>
							Ver histórico
						</Button>
					}
				>
					{overview.activity.loading && !overview.activity.heatDays.length ? (
						<Skeleton lines={6} label="Carregando atividade" />
					) : overview.activity.heatDays.length ? (
						<>
							<ActivityHeatmap
								days={overview.activity.heatDays}
								label="Atividade por dia"
								period="no último ano"
								unit={{ one: 'evento', other: 'eventos' }}
								locale="pt-BR"
								selectedDate={overview.activity.heatDay}
								onSelectDate={(d) =>
									overview.activity.setHeatDay(d === overview.activity.heatDay ? null : d)
								}
							/>
							{overview.activity.heatDay ? (
								<div className={s.formStack}>
									<button
										type="button"
										className={s.link}
										onClick={() => overview.activity.setHeatDay(null)}
									>
										Limpar dia selecionado
									</button>
									{overview.activity.dayEvents?.length ? (
										<Timeline
											events={overview.activity.dayEvents.map((e) => ({
												id: String(e.id),
												at: e.createdAt,
												actor: e.actorEmail ?? undefined,
												title: `${e.action}${e.entityLabel ? ` · ${e.entityLabel}` : ''}`,
												meta: e.entityType,
											}))}
											now={Date.now()}
											label={`Eventos de ${overview.activity.heatDay}`}
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
									events={overview.activity.events}
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
