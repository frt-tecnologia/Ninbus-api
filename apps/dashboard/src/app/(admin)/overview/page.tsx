'use client';

import { FleetLegend, FleetPulse } from '@/components/domain/devices/fleet-pulse';
import { BarChart } from '@/components/domain/observability/bar-chart';
import { PageHeader } from '@/components/layout/page-header';
import {
	BarMeter,
	Kpi,
	RangeProvider,
	Section,
	Signal,
	type TimeRange,
	TimeRangePicker,
	last7d,
	useRange,
} from '@/components/system';
import { useFetch } from '@/hooks/useFetch';
import { companyService, deploymentService, deviceService, observabilityService } from '@/lib/api';
import type { PlatformStats } from '@/lib/api/observability';
import { connectionSignal, deploymentSignal } from '@/lib/design/tokens';
import type { EnrichedDeployment } from '@/types/domain';
import * as React from 'react';
import { useCallback } from 'react';

/**
 * Overview — rich platform observability (super admin).
 *
 * Wraps everything in a RangeProvider so the time window (preset or custom)
 * drives every section: the daily online histogram, the update stats, the
 * top-company ranking, and the update-hour distribution. Reuses the existing
 * FleetPulse + Kpi + BarMeter primitives + the new BarChart.
 */
export default function OverviewPage() {
	return (
		<RangeProvider initial={last7d()}>
			<OverviewBody />
		</RangeProvider>
	);
}

function OverviewBody() {
	const { range } = useRange();

	const companies = useFetch(useCallback(() => companyService.list(), []));
	const devices = useFetch(useCallback(() => deviceService.listAll(), []));
	const stats = useFetch(
		useCallback(
			() => observabilityService.stats({ from: range.from, to: range.to }),
			[range.from, range.to],
		),
		[range.from, range.to],
	);

	const deviceList = React.useMemo(() => devices.data?.data ?? [], [devices.data]);
	const online = React.useMemo(
		() => deviceList.filter((d) => connectionSignal(d.connectionStatus).tone === 'ok').length,
		[deviceList],
	);

	return (
		<>
			<PageHeader
				title="Visão geral"
				description="Observabilidade temporal da frota OTA — atualizações, conectividade e adesão."
				action={<TimeRangePicker />}
			/>
			<OverviewKpis
				online={online}
				totalDevices={deviceList.length}
				totalCompanies={companies.data?.data.length ?? 0}
				stats={stats.data}
				loading={stats.loading}
			/>
			<OverviewCharts stats={stats.data} loading={stats.loading} />
			<FleetPulseSection devices={deviceList} />
			<RecentDeployments range={range} />
			<UserOnboarding stats={stats.data} loading={stats.loading} />
		</>
	);
}

function OverviewKpis({
	online,
	totalDevices,
	totalCompanies,
	stats,
	loading,
}: {
	online: number;
	totalDevices: number;
	totalCompanies: number;
	stats?: PlatformStats | null;
	loading: boolean;
}) {
	const histTotal =
		stats?.onlineHistogram.reduce((s: number, p: { online: number }) => s + p.online, 0) ?? 0;
	return (
		<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
			<Section>
				<Kpi
					label="Dispositivos online agora"
					value={loading ? '…' : online}
					hint={`de ${totalDevices} provisionados`}
					indicator={
						online > 0 ? (
							<Signal token={connectionSignal('online')} glyphOnly size="sm" />
						) : undefined
					}
				/>
			</Section>
			<Section>
				<Kpi
					label="Devices online no período"
					value={loading ? '…' : (stats?.onlineDevices ?? 0)}
					hint={`${histTotal} sessões registradas`}
				/>
			</Section>
			<Section>
				<Kpi
					label="Atualizações no período"
					value={loading ? '…' : (stats?.deploymentCreated ?? 0)}
					hint={`${stats?.artifactUploaded ?? 0} artifacts enviados`}
				/>
			</Section>
			<Section>
				<Kpi
					label="Empresas ativas"
					value={totalCompanies}
					hint={`${stats?.newUserDesignations ?? 0} convites pendentes`}
				/>
			</Section>
		</div>
	);
}

function OverviewCharts({ stats, loading }: { stats?: PlatformStats | null; loading: boolean }) {
	// Histogram x-axis: ensure every day in range has a point (fill gaps with 0).
	const hist = React.useMemo(() => {
		if (!stats) return [];
		const map = new Map(
			stats.onlineHistogram.map((p: { date: string; online: number }) => [p.date, p.online]),
		);
		const out: { label: string; value: number }[] = [];
		const { from, to } = stats.range;
		const start = new Date(from);
		const end = new Date(to);
		for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
			const key = d.toISOString().slice(0, 10);
			out.push({ label: key, value: map.get(key) ?? 0 });
		}
		return out;
	}, [stats]);

	const hours = React.useMemo(() => {
		if (!stats) return [];
		const map = new Map(
			stats.updateHourDistribution.map((h: { hour: number; count: number }) => [h.hour, h.count]),
		);
		return Array.from({ length: 24 }, (_, h) => ({ label: String(h), value: map.get(h) ?? 0 }));
	}, [stats]);

	return (
		<div className="mt-4 grid gap-4 lg:grid-cols-3">
			<Section
				className="lg:col-span-2"
				title="Conectividade diária"
				description="Devices que ficaram online por dia, no período selecionado."
			>
				{loading ? (
					<div className="h-[120px] animate-pulse rounded bg-secondary/60" />
				) : (
					<BarChart data={hist} fillClass="fill-signal-ok" height={140} />
				)}
			</Section>
			<Section
				title="Horários de atualização"
				description="Quando costumam ocorrer os rollouts (0–23h)."
			>
				{loading ? (
					<div className="h-[120px] animate-pulse rounded bg-secondary/60" />
				) : (
					<BarChart data={hours} fillClass="fill-signal-info" height={140} compact />
				)}
			</Section>
		</div>
	);
}

function FleetPulseSection({
	devices,
}: { devices: { connectionStatus: string | null; id: string; name: string }[] }) {
	const counts = React.useMemo(() => {
		const c = { ok: 0, busy: 0, idle: 0, fault: 0, info: 0 };
		for (const d of devices) c[connectionSignal(d.connectionStatus).tone] += 1;
		return c;
	}, [devices]);
	const online = counts.ok;

	return (
		<Section
			className="mt-4"
			title="Frota"
			description="Cada célula é um dispositivo, colorido pelo estado de conexão."
			action={<FleetLegend />}
		>
			{devices.length > 0 ? (
				<>
					<div className="mb-3 flex gap-4">
						<BarMeter label="Online" value={online} max={Math.max(devices.length, 1)} tone="ok" />
						<BarMeter
							label="Inativos"
							value={devices.length - online}
							max={Math.max(devices.length, 1)}
							tone="idle"
						/>
					</div>
					<FleetPulse devices={devices as any} />
				</>
			) : (
				<p className="py-10 text-center text-sm text-muted-foreground">
					Nenhum dispositivo provisionado.
				</p>
			)}
		</Section>
	);
}

function RecentDeployments({ range }: { range: TimeRange }) {
	// Aggregate deployments across companies for the selected range.
	const companies = useFetch(useCallback(() => companyService.list(), []));
	const companyIds = companies.data?.data.map((c) => c.id) ?? [];
	const key = companyIds.join(',');
	const [list, setList] = React.useState<EnrichedDeployment[]>([]);
	const [loading, setLoading] = React.useState(true);

	React.useEffect(() => {
		if (!companyIds.length) return;
		let active = true;
		setLoading(true);
		(async () => {
			try {
				const results = await Promise.allSettled(
					companyIds.map((id) => deploymentService.list(id)),
				);
				if (!active) return;
				const all: EnrichedDeployment[] = [];
				for (const r of results) {
					if (r.status !== 'fulfilled') continue;
					for (const d of r.value.data as EnrichedDeployment[]) {
						const created = d.createdAt ? new Date(d.createdAt * 1000) : null;
						if (created && created >= range.from && created <= range.to) all.push(d);
					}
				}
				all.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
				setList(all.slice(0, 8));
			} catch {
				/* tolerated */
			} finally {
				if (active) setLoading(false);
			}
		})();
		return () => {
			active = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key, range.from.getTime(), range.to.getTime()]);

	return (
		<Section
			className="mt-4"
			title="Atualizações recentes"
			description={`Rollouts criados no período (${range.label}).`}
		>
			{loading ? (
				<div className="space-y-1.5 p-2">
					{Array.from({ length: 3 }).map((_, i) => (
						<div key={i} className="h-8 animate-pulse rounded bg-secondary/60" />
					))}
				</div>
			) : list.length === 0 ? (
				<p className="py-6 text-center text-sm text-muted-foreground">
					Nenhuma atualização no período.
				</p>
			) : (
				<ul className="divide-y divide-border">
					{list.map((d) => {
						const failed = d.statistics.failed;
						return (
							<li key={d.id} className="flex items-center gap-2 px-3 py-2">
								<Signal token={deploymentSignal(d.status)} glyphOnly size="sm" />
								<div className="min-w-0 flex-1">
									<div className="truncate text-xs font-medium text-foreground">
										{d.displayName ?? d.name}
									</div>
									<div className="truncate text-[10px] text-muted-foreground">
										{d.creatorEmail ?? '—'} · {d.artifactName ?? '—'}
									</div>
								</div>
								<div className="flex items-center gap-2 font-mono text-[10px]">
									<span className="text-signal-ok">{d.statistics.finished}</span>
									{failed > 0 && (
										<span className="text-signal-fault" title="Dispositivos com falha">
											{failed}✕
										</span>
									)}
									<span className="text-muted-foreground">/ {d.statistics.totalTargets}</span>
								</div>
							</li>
						);
					})}
				</ul>
			)}
		</Section>
	);
}

function UserOnboarding({ stats, loading }: { stats?: PlatformStats | null; loading: boolean }) {
	return (
		<div className="mt-4 grid gap-4 lg:grid-cols-2">
			<Section title="Adesão de usuários" description="Novos convites (designações) no período.">
				{loading ? (
					<div className="h-16 animate-pulse rounded bg-secondary/60" />
				) : (
					<div className="flex items-center gap-3 p-3">
						<Kpi
							label="Novos convites"
							value={stats?.newUserDesignations ?? 0}
							hint="aguardando cadastro"
						/>
						<p className="flex-1 text-xs text-muted-foreground">
							Designações criadas no período — usuários que ganharão acesso ao se cadastrar.
						</p>
					</div>
				)}
			</Section>
			<Section title="Empresas mais ativas" description="Quem mais realizou operações no período.">
				{loading ? (
					<div className="h-16 animate-pulse rounded bg-secondary/60" />
				) : (stats?.topCompanies.length ?? 0) === 0 ? (
					<p className="py-6 text-center text-sm text-muted-foreground">
						Sem atividade registrada no período.
					</p>
				) : (
					<ul className="divide-y divide-border">
						{(stats?.topCompanies ?? []).map((c) => (
							<li key={c.companyId} className="flex items-center justify-between px-3 py-1.5">
								<span className="truncate text-xs text-foreground">{c.companyName ?? '—'}</span>
								<span className="font-mono text-[10px] text-muted-foreground">{c.actions}</span>
							</li>
						))}
					</ul>
				)}
			</Section>
		</div>
	);
}
