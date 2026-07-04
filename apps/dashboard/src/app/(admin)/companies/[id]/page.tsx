'use client';

import { useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Section, Id, Signal, Time, Empty } from '@/components/system';
import { Button } from '@/components/ui/button';
import { useFetch } from '@/hooks/useFetch';
import {
	companyService,
	deploymentService,
	deviceService,
	memberService,
} from '@/lib/api';
import { connectionSignal, deploymentSignal, deviceSignal } from '@/lib/design/tokens';

/**
 * Company detail — the link target for company names across the dashboard.
 *
 * Shows the company's members, devices and deployments in one place, so a
 * click on a company name anywhere leads here. Deployments and devices link
 * onward to their own detail pages.
 */
export default function CompanyDetailPage() {
	const params = useParams<{ id: string }>();
	const router = useRouter();
	const companyId = params.id;

	const company = useFetch(useCallback(() => companyService.get(companyId), [companyId]), [
		companyId,
	]);
	const members = useFetch(useCallback(() => memberService.list(companyId), [companyId]), [
		companyId,
	]);
	const devices = useFetch(useCallback(() => deviceService.listByCompany(companyId), [companyId]), [
		companyId,
	]);
	const deployments = useFetch(
		useCallback(() => deploymentService.list(companyId), [companyId]),
		[companyId],
	);

	const c = company.data;
	return (
		<>
			<PageHeader
				title={c?.name ?? 'Carregando…'}
				description={c ? `${c.deviceCount} devices · ${c.memberCount} membros` : undefined}
				action={
					<Button variant="outline" size="sm" onClick={() => router.push('/companies')} className="h-8">
						<ArrowLeft className="mr-1.5 h-4 w-4" />
						Voltar
					</Button>
				}
			/>
			{company.error ? (
				<p className="py-12 text-center text-sm text-muted-foreground">
					Empresa não encontrada ou você não tem acesso.
				</p>
			) : (
				<div className="space-y-4">
					<Section title="Deployments" description="Atualizações OTA desta empresa.">
						{deployments.loading ? (
							<p className="p-4 text-sm text-muted-foreground">Carregando…</p>
						) : (deployments.data?.data ?? []).length === 0 ? (
							<Empty title="Sem deployments" description="Nenhuma atualização criada." />
						) : (
							<ul className="divide-y divide-border">
								{(deployments.data?.data ?? []).map((d) => (
									<li key={d.id} className="flex items-center gap-2 px-3 py-2">
										<Signal token={deploymentSignal(d.status)} glyphOnly size="sm" />
										<div className="min-w-0 flex-1">
											<Link
												href={`/deployments/${companyId}/${d.id}`}
												className="block truncate text-sm font-medium text-foreground hover:text-primary hover:underline"
											>
												{d.displayName ?? d.name}
											</Link>
											<span className="truncate text-[10px] text-muted-foreground">
												{d.artifactName ?? '—'}
											</span>
										</div>
										<span className="font-mono text-[10px] text-muted-foreground">
											{d.statistics.finished}/{d.statistics.totalTargets}
										</span>
									</li>
								))}
							</ul>
						)}
					</Section>

					<Section title="Dispositivos" description="Frota vinculada a esta empresa.">
						{devices.loading ? (
							<p className="p-4 text-sm text-muted-foreground">Carregando…</p>
						) : (devices.data?.data ?? []).length === 0 ? (
							<Empty title="Sem dispositivos" description="Nenhum device vinculado." />
						) : (
							<ul className="divide-y divide-border">
								{(devices.data?.data ?? []).map((d) => (
									<li key={d.id} className="flex items-center gap-2 px-3 py-2">
										<Signal token={deviceSignal(d.status)} glyphOnly size="sm" />
										<div className="min-w-0 flex-1">
											<span className="block truncate text-sm font-medium text-foreground">
												{d.name}
											</span>
											<Id value={d.serialDisplay ?? d.serialNumber ?? d.hawkbitTargetId ?? '—'} className="text-[10px]" />
										</div>
										<Signal token={connectionSignal(d.connectionStatus)} glyphOnly size="sm" />
									</li>
								))}
							</ul>
						)}
					</Section>

					<Section title="Membros" description="Quem tem acesso a esta empresa.">
						{members.loading ? (
							<p className="p-4 text-sm text-muted-foreground">Carregando…</p>
						) : (members.data?.data ?? []).length === 0 ? (
							<Empty title="Sem membros" />
						) : (
							<ul className="divide-y divide-border">
								{(members.data?.data ?? []).map((m) => (
									<li key={m.userId} className="flex items-center gap-2 px-3 py-2">
										<div className="min-w-0 flex-1">
											<span className="block truncate text-sm font-medium">{m.name || m.email}</span>
											<Id value={m.email} className="text-[10px] text-muted-foreground" />
										</div>
										<span className="font-mono text-[10px] uppercase text-muted-foreground">{m.role}</span>
									</li>
								))}
							</ul>
						)}
					</Section>
				</div>
			)}
		</>
	);
}
