'use client';
/**
 * Audit — platform-wide activity: day heatmap filter + event Collection +
 * period filter. All REAL (observabilityService.activity).
 */
import * as React from 'react';
import { ActivityHeatmap } from '@/components/arc/activity-heatmap/activity-heatmap';
import s from '@/components/arc-app/app.module.css';
import { Guard, PageHead } from '@/components/arc-app/page-head';
import { PollingMenu } from '@/components/arc-app/polling-menu';
import { Collection, inPeriod, Panel, type Period, stamp } from '@/components/arc-app/primitives';
import { companyService, observabilityService } from '@/lib/api';
import { qk } from '@/lib/cache/keys';
import { useQuery } from '@/lib/cache/use-query';

export default function AuditPage() {
	const activity = useQuery(
		'activity:heat:audit-1y',
		React.useCallback(
			() =>
				observabilityService.activity({
					limit: 200,
					from: new Date(Date.now() - 365 * 86_400_000),
					to: new Date(),
				}),
			[],
		),
	);
	const companies = useQuery(
		qk.adminCompanies,
		React.useCallback(() => companyService.list(), []),
		{ sync: false },
	);

	const [period, setPeriod] = React.useState<Period | null>(null);
	const [heatDay, setHeatDay] = React.useState<string | null>(null);

	const events = activity.data?.data ?? [];
	const companyList = companies.data?.data ?? [];

	const filtered = events.filter(
		(e) =>
			inPeriod(e.createdAt, period) &&
			(!heatDay ||
				new Date(e.createdAt).toLocaleDateString('en-CA', { timeZone: 'America/Recife' }) ===
					heatDay),
	);

	const days = Array.from({ length: 365 }, (_, i) => {
		const date = new Date(Date.now() - (364 - i) * 86_400_000).toISOString().slice(0, 10);
		return {
			date,
			count: events.filter(
				(e) =>
					new Date(e.createdAt).toLocaleDateString('en-CA', { timeZone: 'America/Recife' }) ===
					date,
			).length,
		};
	});

	return (
		<>
			<PageHead
				title="Atividade"
				description="Rastreabilidade de alterações com data, hora e contexto."
			/>
			<Guard loading={activity.loading} error={activity.error} onRetry={activity.refetch}>
				<PollingMenu />
				<Panel
					title="Atividade por dia"
					description="Selecione um dia para filtrar o histórico abaixo"
				>
					<ActivityHeatmap
						days={days}
						label="Eventos por dia"
						period="no último ano"
						unit={{ one: 'evento', other: 'eventos' }}
						selectedDate={heatDay}
						onSelectDate={(v) => setHeatDay(v === heatDay ? null : v)}
						locale="pt-BR"
					/>
					{heatDay && (
						<button type="button" className={s.link} onClick={() => setHeatDay(null)}>
							Limpar dia selecionado
						</button>
					)}
				</Panel>
				<Collection
					label="Eventos de auditoria"
					rows={filtered.map((e) => ({
						...e,
						company: companyList.find((c) => c.id === e.companyId)?.name ?? '—',
					}))}
					dateKey="createdAt"
					period={period}
					onPeriodChange={setPeriod}
					dateMeaning="Período aplica-se a quando o evento ocorreu"
					fields={[
						{ id: 'company', label: 'Empresa', options: companyList.map((c) => c.name) },
						{
							id: 'action',
							label: 'Tipo de atividade',
							options: [...new Set(events.map((e) => e.action).filter(Boolean))].map((a) =>
								String(a),
							),
						},
					]}
					columns={[
						{ key: 'actorEmail', label: 'Quem' },
						{
							key: 'action',
							label: 'O que',
							render: (_, r) => (
								<span>
									{r.action}
									<span className={s.cellSub}>{r.entityLabel ?? r.entityType}</span>
								</span>
							),
						},
						{ key: 'company', label: 'Empresa' },
						{ key: 'createdAt', label: 'Quando', render: (v) => stamp(String(v)) },
					]}
				/>
			</Guard>
		</>
	);
}
