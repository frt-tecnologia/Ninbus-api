'use client';
import { useRouter } from 'next/navigation';
/**
 * Audit — platform-wide activity: day heatmap filter + event Collection +
 * connection timeline. All REAL endpoints (observabilityService).
 *
 * The year heatmap comes from the server-side per-day GROUP BY
 * (/admin/activity/heat) — the raw feed below is only the newest page for
 * the Collection. Both derivations are memoized: they used to recompute
 * ~73k date formats on every render (every keystroke in the search).
 */
import * as React from 'react';
import { ActivityHeatmap } from '@/components/arc/activity-heatmap/activity-heatmap';
import s from '@/components/arc-app/app.module.css';
import { ConnectionHistorySection } from '@/components/arc-app/connection-history-section';
import { Guard, PageHead } from '@/components/arc-app/page-head';
import { PollingMenu } from '@/components/arc-app/polling-menu';
import { Collection, inPeriod, Panel, type Period, stamp } from '@/components/arc-app/primitives';
import { companyService, deviceService, observabilityService } from '@/lib/api';
import { qk } from '@/lib/cache/keys';
import { useQuery } from '@/lib/cache/use-query';

const HEAT_WINDOW_MS = 365 * 86_400_000;

function deviceDayKey(value: string): string {
	return new Date(value).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

export default function AuditPage() {
	const router = useRouter();
	const heat = useQuery(
		'activity:heat:1y',
		React.useCallback(
			() =>
				observabilityService.activityHeat({
					from: new Date(Date.now() - HEAT_WINDOW_MS),
					to: new Date(),
				}),
			[],
		),
	);
	const activity = useQuery(
		'activity:feed:audit',
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
	const devices = useQuery(
		qk.adminDevices,
		React.useCallback(() => deviceService.listAll(), []),
		{ sync: false },
	);

	const [period, setPeriod] = React.useState<Period | null>(null);
	const [heatDay, setHeatDay] = React.useState<string | null>(null);

	const events = activity.data?.data ?? [];
	const companyList = companies.data?.data ?? [];
	const deviceList = devices.data?.data ?? [];

	const filtered = React.useMemo(
		() =>
			events.filter(
				(e) => inPeriod(e.createdAt, period) && (!heatDay || deviceDayKey(e.createdAt) === heatDay),
			),
		[events, period, heatDay],
	);

	const days = React.useMemo(
		() =>
			(heat.data?.data ?? []).map((bucket) => ({
				date: bucket.bucket,
				count: bucket.count,
			})),
		[heat.data],
	);

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
				{/* Rolagem horizontal no mobile: wrapper permite o scroll e o
				    min-width interno evita que as colunas sejam espremidas. */}
				<div className="w-full overflow-x-auto">
					<div className="min-w-[900px]">
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
					</div>
				</div>
				<ConnectionHistorySection
					companies={companyList}
					devices={deviceList}
					initialPeriod={period}
					onManageDevice={(device) => router.push(`/devices?detail=${device.id}`)}
				/>
			</Guard>
		</>
	);
}
