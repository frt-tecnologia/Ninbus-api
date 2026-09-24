'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useMemo } from 'react';
import { FirmwareForceDialog } from '@/components/domain/firmware/firmware-force-dialog';
import { PageHeader } from '@/components/layout/page-header';
import { Empty, Id, Relative, Section, Signal, Time } from '@/components/system';
import { Button } from '@/components/ui/button';
import { useFetch } from '@/hooks/useFetch';
import { companyService, deploymentService, deviceService, firmwareService } from '@/lib/api';
import {
	connectionSignal,
	deploymentSignal,
	deviceSignal,
	firmwareSignal,
} from '@/lib/design/tokens';

/**
 * Device detail — the link target for a device serial/name anywhere in the
 * dashboard. Shows the device's identity, connection/health signals, its
 * company (link) and the deployments of that company (links).
 *
 * Fetched via the super-admin device list (the single-device endpoint is
 * company-scoped); we find the matching id. This keeps navigation possible
 * from any screen that only carries the device id.
 */
export default function DeviceDetailPage() {
	const params = useParams<{ id: string }>();
	const router = useRouter();
	const deviceId = params.id;

	const all = useFetch(useCallback(() => deviceService.listAll(), []));
	const device = useMemo(
		() => (all.data?.data ?? []).find((d) => d.id === deviceId) ?? null,
		[all.data, deviceId],
	);

	const companyId = device?.companyId ?? null;
	const company = useFetch(
		useCallback(() => (companyId ? companyService.get(companyId) : Promise.reject()), [companyId]),
		[companyId],
	);
	const deployments = useFetch(
		useCallback(
			() =>
				companyId ? deploymentService.list(companyId) : Promise.resolve({ data: [], total: 0 }),
			[companyId],
		),
		[companyId],
	);
	const latestFirmware = useFetch(useCallback(() => firmwareService.latest('firmware-ninbus'), []));

	return (
		<>
			<PageHeader
				title={device?.name ?? device?.serialDisplay ?? 'Dispositivo'}
				description={device ? (device.serialDisplay ?? device.serialNumber ?? '—') : 'Carregando…'}
				action={
					<Button
						variant="outline"
						size="sm"
						onClick={() => router.push('/devices')}
						className="h-8"
					>
						<ArrowLeft className="mr-1.5 h-4 w-4" />
						Voltar
					</Button>
				}
			/>
			{all.error ? (
				<p className="py-12 text-center text-sm text-muted-foreground">
					Dispositivo não encontrado.
				</p>
			) : device ? (
				<div className="space-y-4">
					{/* Identity + signals */}
					<Section title="Identidade" description="Metadados do dispositivo.">
						<dl className="grid grid-cols-2 gap-2 px-3 py-2 text-sm">
							<Row label="Nome" value={device.name || '—'} />
							<Row
								label="Serial"
								value={<Id value={device.serialDisplay ?? device.serialNumber ?? '—'} copy />}
							/>
							<Row
								label="Empresa"
								value={
									company.data ? (
										<Link
											href={`/companies/${company.data.id}`}
											className="text-foreground hover:text-primary hover:underline"
										>
											{company.data.name}
										</Link>
									) : (
										'Sem empresa'
									)
								}
							/>
							<Row label="Target" value={<Id value={device.hawkbitTargetId ?? '—'} />} />
							<Row
								label="Status"
								value={<Signal token={deviceSignal(device.status)} size="sm" />}
							/>
							<Row
								label="Conexão"
								value={<Signal token={connectionSignal(device.connectionStatus)} size="sm" />}
							/>
							<Row label="Última conexão" value={<Relative value={device.lastSeenAt} />} />
							<Row label="Adicionado" value={<Time value={device.createdAt} />} />
						</dl>
					</Section>

					{/* Firmware — device + peripheral versions vs the factory catalog */}
					<Section
						title="Firmware"
						description={
							latestFirmware.data?.data
								? `Última release da fábrica: ${latestFirmware.data.data.version} (${latestFirmware.data.data.name}).`
								: 'Nenhuma release publicada pela fábrica ainda.'
						}
					>
						<dl className="grid grid-cols-2 gap-2 px-3 py-2 text-sm">
							<Row
								label="Firmware Ninbus"
								value={
									<>
										<Signal token={firmwareSignal(device.firmwareStatus)} size="sm" />
										<span className="mt-0.5 font-mono text-xs">
											{device.firmwareVersion ?? 'versão não reportada'}
										</span>
									</>
								}
							/>
							<Row
								label="Controlador (periférico)"
								value={
									<span className="font-mono text-xs">
										{device.controllerFirmwareVersion ?? 'versão não reportada'}
									</span>
								}
							/>
							<Row
								label="Mais recente (fábrica)"
								value={
									<span className="font-mono text-xs">{device.latestFirmwareVersion ?? '—'}</span>
								}
							/>
							<Row
								label="Último update hawkBit"
								value={
									<Signal
										token={deploymentSignal(device.hawkbitUpdateStatus ?? 'unknown')}
										size="sm"
									/>
								}
							/>
						</dl>
						{device.firmwareStatus === 'update_available' && device.latestFirmwareVersion && (
							<div className="border-t px-3 py-2">
								<FirmwareForceDialog
									trigger
									targetVersion={device.latestFirmwareVersion}
									devices={[
										{
											id: device.id,
											name: device.name,
											serialDisplay: device.serialDisplay,
											firmwareVersion: device.firmwareVersion,
										},
									]}
								/>
							</div>
						)}
						{device.hawkbitUpdateStatus === 'error' && (
							<p className="px-3 pb-3 text-xs text-signal-fault">
								A última tentativa de atualização falhou — verifique o histórico de deployments.
							</p>
						)}
					</Section>

					{/* Company deployments */}
					{companyId && (
						<Section
							title="Deployments da empresa"
							description="Atualizações OTA associadas à empresa deste dispositivo."
						>
							{(deployments.data?.data ?? []).length === 0 ? (
								<Empty title="Sem deployments" />
							) : (
								<ul className="divide-y divide-border">
									{(deployments.data?.data ?? []).map((d) => (
										<li key={d.id} className="flex items-center gap-2 px-3 py-2">
											<Signal token={deploymentSignal(d.status)} glyphOnly size="sm" />
											<Link
												href={`/deployments/${companyId}/${d.id}`}
												className="min-w-0 flex-1 truncate text-sm font-medium text-foreground hover:text-primary hover:underline"
											>
												{d.displayName ?? d.name}
											</Link>
											<span className="font-mono text-[10px] text-muted-foreground">
												{d.statistics.finished}/{d.statistics.totalTargets}
											</span>
										</li>
									))}
								</ul>
							)}
						</Section>
					)}
				</div>
			) : null}
		</>
	);
}

function Row({ label, value }: { label: string; value: ReactNode }) {
	return (
		<div className="flex flex-col gap-0.5">
			<dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
			<dd className="text-foreground">{value}</dd>
		</div>
	);
}
