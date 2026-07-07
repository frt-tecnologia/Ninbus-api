'use client';

import * as React from 'react';
import { useCallback } from 'react';
import type { Company, Device, EnrichedDeployment } from '@/types/domain';
import { connectionSignal, deploymentSignal } from '@/lib/design/tokens';
import { PageHeader } from '@/components/layout/page-header';
import { Section, Kpi, Signal, BarMeter, RangeProvider, useRange, TimeRangePicker } from '@/components/system';
import { useFetch } from '@/hooks/useFetch';
import { useAllDeployments } from '@/hooks/use-all-deployments';
import { companyService, deviceService, userService, designationService } from '@/lib/api';
import { RolloutActivity } from '@/components/domain/overview/rollout-activity';
import { FirmwareRollout } from '@/components/domain/overview/firmware-rollout';
import { DottedMap } from '@/components/domain/overview/dotted-map';

/**
 * Overview — platform-wide health at a glance (CLIENT component).
 *
 * A <RangeProvider> wraps the body so the shared time-window picker drives
 * every time-sensitive view (rollout activity). The picker lives in the page
 * header action slot.
 */
export default function OverviewPage() {
	const companies = useFetch(useCallback(() => companyService.list(), []));
	const devices = useFetch(useCallback(() => deviceService.listAll(), []));
	const users = useFetch(useCallback(() => userService.list(), []));
	const designations = useFetch(useCallback(() => designationService.listPending(), []));

	const companyList = React.useMemo(() => companies.data?.data ?? [], [companies.data]);
	const deviceList = React.useMemo(() => devices.data?.data ?? [], [devices.data]);
	const all = useAllDeployments(companyList);

	return (
		<RangeProvider>
			<OverviewBody
				companyList={companyList}
				deviceList={deviceList}
				usersCount={users.data?.data.length ?? 0}
				pendingCount={designations.data?.data.length ?? 0}
				deployments={all.deployments}
				byCompany={all.byCompany}
				deployLoading={all.loading}
			/>
		</RangeProvider>
	);
}

function OverviewBody({
	companyList,
	deviceList,
	usersCount,
	pendingCount,
	deployments,
	byCompany,
	deployLoading,
}: {
	companyList: Company[];
	deviceList: Device[];
	usersCount: number;
	pendingCount: number;
	deployments: EnrichedDeployment[];
	byCompany: Record<string, EnrichedDeployment[]>;
	deployLoading: boolean;
}) {
	const { range } = useRange();

	const online = React.useMemo(() => {
		let n = 0;
		for (const d of deviceList) if (connectionSignal(d.connectionStatus).tone === 'ok') n++;
		return n;
	}, [deviceList]);

	const { inProgress, completed, failed, totalTargets } = React.useMemo(() => {
		let inProgress = 0;
		let completed = 0;
		let failed = 0;
		let totalTargets = 0;
		for (const d of deployments) {
			if (d.status === 'in_progress') inProgress++;
			else if (d.status === 'completed') completed++;
			else if (d.status === 'failed') failed++;
			totalTargets += d.statistics?.totalTargets ?? 0;
		}
		return { inProgress, completed, failed, totalTargets };
	}, [deployments]);

	return (
		<>
			<PageHeader
				title="Visão geral"
				description="Estado global da frota OTA em tempo real."
				action={<TimeRangePicker />}
			/>

			{/* KPI strip */}
			<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
				<Section>
					<Kpi
						label="Dispositivos"
						value={deviceList.length}
						hint={`${online} online · ${deviceList.length - online} inativos`}
					/>
				</Section>
				<Section>
					<Kpi label="Empresas" value={companyList.length} hint="tenants ativos" />
				</Section>
				<Section>
					<Kpi
						label="Usuários"
						value={usersCount}
						hint={`${pendingCount} convites pendentes`}
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

			{/* Rollout activity (time-series, driven by the time window) + fleet snapshot */}
			<div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
				<RolloutActivity deployments={deployments} loading={deployLoading} from={range.from} to={range.to} />
				<Section title="Conexão da frota" description="Dispositivos ativos agora.">
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
						<div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
							{inProgress} rollouts ativos · {totalTargets} dispositivos alvo
						</div>
					</div>
				</Section>
			</div>

			{/* Firmware rollout per company */}
			<div className="mt-4">
				<FirmwareRollout companies={companyList} deploymentsByCompany={byCompany} loading={deployLoading} />
			</div>

			{/* Forward-looking deployment geo-telemetry
			<div className="mt-4">
				<Section
					title="Telemetria de deployments"
					description="Mapa de sucesso, falhas e pendências por região (em evolução)."
				>
					<DottedMap />
				</Section>
			</div> */}
		</>
	);
}
