'use client';

import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import type { Device, EnrichedDeployment } from '@/types/domain';
import { connectionSignal, deploymentSignal } from '@/lib/design/tokens';
import { PageHeader } from '@/components/layout/page-header';
import { Section, Kpi, BarMeter, Signal, SignalDot } from '@/components/system';
import { FleetPulse, FleetLegend } from '@/components/domain/devices/fleet-pulse';
import { useFetch } from '@/hooks/useFetch';
import { companyService, deviceService, userService, designationService, deploymentService } from '@/lib/api';

/**
 * Overview — platform-wide health at a glance (CLIENT component).
 *
 * WHY client: the browser runs same-origin through the Route Handler proxy
 * (`/admin/api/*`), which has a real document origin. The previous server
 * component silently failed (`fetch('/admin/api/...')` has no origin on the
 * server) → every count was zero. As a client component it behaves like every
 * other page (devices/companies/…), which already work.
 */
export default function OverviewPage() {
	const companies = useFetch(useCallback(() => companyService.list(), []));
	const devices = useFetch(useCallback(() => deviceService.listAll(), []));
	const users = useFetch(useCallback(() => userService.list(), []));
	const designations = useFetch(useCallback(() => designationService.listPending(), []));

	const companyList = companies.data?.data ?? [];

	// ── Fleet health by connection signal tone ────────────────────────
	const deviceList = React.useMemo(() => devices.data?.data ?? [], [devices.data]);
	const counts = React.useMemo(() => {
		const c = { ok: 0, busy: 0, idle: 0, fault: 0, info: 0 };
		for (const d of deviceList) {
			const tone = connectionSignal(d.connectionStatus).tone;
			c[tone] += 1;
		}
		return c;
	}, [deviceList]);
	const online = counts.ok;
	const offline = counts.idle; // offline + unknown both resolve to 'idle' tone

	// ── OTA rollups (aggregate deployments across companies) ──────────
	const { inProgress, completed, failed, totalTargets } = useDeploymentRollup(
		companyList.map((c) => c.id),
	);

	return (
		<>
			<PageHeader
				title="Visão geral"
				description="Estado global da frota OTA em tempo real."
			/>

			{/* KPI strip */}
			<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
				<Section>
					<Kpi label="Dispositivos" value={deviceList.length} hint={`${online} online · ${deviceList.length - online} inativos`} />
				</Section>
				<Section>
					<Kpi label="Empresas" value={companyList.length} hint="tenants ativos" />
				</Section>
				<Section>
					<Kpi
						label="Usuários"
						value={users.data?.data.length ?? 0}
						hint={`${designations.data?.data.length ?? 0} convites pendentes`}
					/>
				</Section>
				<Section>
					<Kpi
						label="Atualizações em andamento"
						value={inProgress}
						hint={`${completed} concluídas · ${failed} falhas`}
						indicator={
							inProgress > 0 ? (
								<Signal token={deploymentSignal('in_progress')} glyphOnly size="sm" />
							) : undefined
						}
					/>
				</Section>
			</div>

			{/* Fleet health + OTA activity gauges */}
			<div className="mt-4 grid gap-4 lg:grid-cols-2">
				<Section title="Saúde da frota" description="Distribuição por estado de conexão.">
					<div className="flex flex-col gap-4">
						<BarMeter
							label="Online"
							value={online}
							max={Math.max(deviceList.length, 1)}
							tone="ok"
							hint="Dispositivos ativos agora."
						/>
						<BarMeter
							label="Inativos"
							value={deviceList.length - online}
							max={Math.max(deviceList.length, 1)}
							tone="idle"
						/>
					</div>
				</Section>

				<Section title="Atividade de atualização" description="Rollups OTA agregados entre todas as empresas.">
					<div className="flex flex-col gap-4">
						<BarMeter
							label="Concluídos"
							value={completed}
							max={Math.max(completed + inProgress + failed, 1)}
							tone="ok"
						/>
						<BarMeter
							label="Em andamento"
							value={inProgress}
							max={Math.max(completed + inProgress + failed, 1)}
							tone="busy"
						/>
						<BarMeter
							label="Falhas"
							value={failed}
							max={Math.max(completed + inProgress + failed, 1)}
							tone="fault"
						/>
						<div className="flex items-center gap-2 pt-1 text-sm text-muted-foreground">
							<SignalDot token={deploymentSignal('in_progress')} />
							{inProgress} rollouts ativos · {totalTargets} dispositivos alvo no total
						</div>
					</div>
				</Section>
			</div>

			{/* Fleet pulse — the signature overview visual */}
			<Section
				title="Frota"
				description="Cada célula é um dispositivo, colorido pelo estado de conexão."
				className="mt-4"
				action={<FleetLegend />}
			>
				{deviceList.length > 0 ? (
					<FleetPulse devices={deviceList} />
				) : (
					<p className="py-10 text-center text-sm text-muted-foreground">
						Nenhum dispositivo provisionado.
					</p>
				)}
			</Section>
		</>
	);
}

/**
 * Aggregate OTA deployment statistics across N companies (parallel fetch,
 * tolerant of per-company failures). Company IDs are joined into a stable key
 * so the effect re-runs only when the set changes, not on every render.
 */
function useDeploymentRollup(companyIds: string[]) {
	const [stats, setStats] = useState({
		inProgress: 0,
		completed: 0,
		failed: 0,
		totalTargets: 0,
	});
	const key = companyIds.join(',');

	useEffect(() => {
		if (!companyIds.length) return;
		let active = true;
		(async () => {
			try {
				const results = await Promise.allSettled(
					companyIds.map((id) => deploymentService.list(id)),
				);
				if (!active) return;
				let inProgress = 0;
				let completed = 0;
				let failed = 0;
				let totalTargets = 0;
				for (const r of results) {
					if (r.status !== 'fulfilled') continue;
					for (const d of r.value.data as EnrichedDeployment[]) {
						if (d.status === 'in_progress') inProgress++;
						else if (d.status === 'completed') completed++;
						else if (d.status === 'failed') failed++;
						totalTargets += d.statistics?.totalTargets ?? 0;
					}
				}
				setStats({ inProgress, completed, failed, totalTargets });
			} catch {
				/* tolerated — overview must not crash */
			}
		})();
		return () => {
			active = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key]);

	return stats;
}
