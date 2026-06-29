import { companyService, deviceService, userService, designationService } from '@/lib/api';
import type { Device } from '@/types/domain';
import { connectionSignal } from '@/lib/design/tokens';
import { PageHeader } from '@/components/layout/page-header';
import { Section } from '@/components/system';
import { Kpi } from '@/components/system';
import { Signal } from '@/components/system';
import { FleetPulse, FleetLegend } from '@/components/domain/devices/fleet-pulse';

/**
 * Overview — platform-wide health at a glance.
 *
 * The signature element is <FleetPulse>: every device as one colored cell, so
 * fleet health reads in one glance. KPIs use large tabular figures (no
 * icon-in-a-box trope). All data fetched server-side; partial failures tolerated.
 */
export default async function OverviewPage() {
	const [companies, devices, users, designations] = await Promise.allSettled([
		companyService.list(),
		deviceService.listAll(),
		userService.list(),
		designationService.listPending(),
	]);

	const companyCount = fulfilled(companies)?.data.length ?? 0;
	const deviceList = fulfilled(devices)?.data ?? [];
	const userCount = fulfilled(users)?.data.length ?? 0;
	const pendingCount = fulfilled(designations)?.data.length ?? 0;

	const online = deviceList.filter((d) => connectionSignal(d.connectionStatus).tone === 'ok').length;
	const offline = deviceList.filter((d) => connectionSignal(d.connectionStatus).tone === 'idle').length;

	return (
		<>
			<PageHeader
				title="Visão geral"
				description="Estado global da frota OTA em tempo real."
			/>

			<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
				<Section>
					<Kpi label="Dispositivos" value={deviceList.length} hint={`${online} online · ${offline} offline`} />
				</Section>
				<Section>
					<Kpi label="Empresas" value={companyCount} hint="tenants ativos" />
				</Section>
				<Section>
					<Kpi label="Usuários" value={userCount} hint="contas cadastradas" />
				</Section>
				<Section>
					<Kpi
						label="Designações pendentes"
						value={pendingCount}
						hint="emails aguardando registro"
						indicator={
							pendingCount > 0 ? (
								<Signal token={connectionSignal('unknown')} glyphOnly size="sm" />
							) : undefined
						}
					/>
				</Section>
			</div>

			<Section
				title="Frota"
				description="Cada célula é um dispositivo, colorido pelo estado de conexão."
				className="mt-4"
				action={<FleetLegend />}
			>
				{deviceList.length > 0 ? (
					<FleetPulse devices={deviceList} />
				) : (
					<p className="py-8 text-center text-sm text-muted-foreground">
						Nenhum dispositivo provisionado.
					</p>
				)}
			</Section>
		</>
	);
}

function fulfilled<T>(r: PromiseSettledResult<T>): T | null {
	return r.status === 'fulfilled' ? r.value : null;
}
