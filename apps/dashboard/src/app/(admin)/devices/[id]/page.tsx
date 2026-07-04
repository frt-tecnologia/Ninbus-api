'use client';

import { useCallback, useMemo, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Section, Signal, Id, Relative, Time, Empty } from '@/components/system';
import { Button } from '@/components/ui/button';
import { useFetch } from '@/hooks/useFetch';
import { companyService, deploymentService, deviceService } from '@/lib/api';
import { connectionSignal, deviceSignal, deploymentSignal } from '@/lib/design/tokens';

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
			() => (companyId ? deploymentService.list(companyId) : Promise.resolve({ data: [], total: 0 })),
			[companyId],
		),
		[companyId],
	);

	return (
		<>
			<PageHeader
				title={device?.name ?? device?.serialDisplay ?? 'Dispositivo'}
				description={device ? (device.serialDisplay ?? device.serialNumber ?? '—') : 'Carregando…'}
				action={
					<Button variant="outline" size="sm" onClick={() => router.push('/devices')} className="h-8">
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
							<Row label="Serial" value={<Id value={device.serialDisplay ?? device.serialNumber ?? '—'} copy />} />
							<Row
								label="Empresa"
								value={
									company.data ? (
										<Link href={`/companies/${company.data.id}`} className="text-foreground hover:text-primary hover:underline">
											{company.data.name}
										</Link>
									) : (
										'Sem empresa'
									)
								}
							/>
							<Row label="Target" value={<Id value={device.hawkbitTargetId ?? '—'} />} />
							<Row label="Status" value={<Signal token={deviceSignal(device.status)} size="sm" />} />
							<Row label="Conexão" value={<Signal token={connectionSignal(device.connectionStatus)} size="sm" />} />
							<Row label="Última conexão" value={<Relative value={device.lastSeenAt} />} />
							<Row label="Adicionado" value={<Time value={device.createdAt} />} />
						</dl>
					</Section>

					{/* Company deployments */}
					{companyId && (
						<Section title="Deployments da empresa" description="Atualizações OTA associadas à empresa deste dispositivo.">
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
