'use client';

import { useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Section, Signal, Id, Empty } from '@/components/system';
import { Button } from '@/components/ui/button';
import { useFetch } from '@/hooks/useFetch';
import { deploymentService } from '@/lib/api';
import type { EnrichedDeployment, TargetDeploymentStatus } from '@/types/domain';
import { phaseSignal } from '@/lib/design/tokens';

/**
 * Deployment detail — the link target for a deployment name. Shows WHICH
 * devices updated, failed, are in progress or still pending (not just the
 * counts), grouped by outcome. Each group is a list of controllerId + name +
 * phase signal + last message.
 *
 * Endpoints:
 *  GET /api/companies/:id/deployments                → find this deployment
 *  GET /api/companies/:id/deployments/:dsId/target-statuses → per-device outcome
 */
export default function DeploymentDetailPage() {
	const params = useParams<{ companyId: string; deploymentId: string }>();
	const router = useRouter();
	const { companyId, deploymentId } = params;

	const deployments = useFetch(
		useCallback(() => deploymentService.list(companyId), [companyId]),
		[companyId],
	);
	const statuses = useFetch(
		useCallback(
			() => deploymentService.targetStatuses(companyId, deploymentId),
			[companyId, deploymentId],
		),
		[companyId, deploymentId],
	);

	const deployment = useMemo(
		() =>
			(deployments.data?.data ?? []).find((d) => String(d.id) === String(deploymentId)) ??
			null,
		[deployments.data, deploymentId],
	);

	return (
		<>
			<PageHeader
				title={deployment?.displayName ?? deployment?.name ?? `Deployment #${deploymentId}`}
				description={
					deployment
						? `${deployment.artifactName ?? '—'}${
								deployment.artifactVersion ? ` v${deployment.artifactVersion}` : ''
							}`
						: 'Carregando…'
				}
				action={
					<Button
						variant="outline"
						size="sm"
						onClick={() => router.push('/deployments')}
						className="h-8"
					>
						<ArrowLeft className="mr-1.5 h-4 w-4" />
						Voltar
					</Button>
				}
			/>

			{statuses.error ? (
				<p className="py-12 text-center text-sm text-muted-foreground">
					Não foi possível carregar os dispositivos deste deployment.
				</p>
			) : (
				<DeviceBreakdown
					targets={statuses.data?.data ?? []}
					loading={statuses.loading}
					companyId={companyId}
				/>
			)}
		</>
	);
}

// ── Device breakdown by outcome ────────────────────────────────────────

const GROUP_ORDER = ['installed', 'error', 'canceled', 'downloading', 'downloaded', 'installing', 'pending', 'assigned', 'unknown'] as const;
const GROUP_LABEL: Record<string, string> = {
	installed: 'Atualizados',
	error: 'Com falha',
	canceled: 'Cancelados',
	downloading: 'Baixando',
	downloaded: 'Baixado',
	installing: 'Instalando',
	pending: 'Pendentes',
	assigned: 'Atribuídos',
	unknown: 'Sem status',
};

function DeviceBreakdown({
	targets,
	loading,
	companyId,
}: {
	targets: TargetDeploymentStatus[];
	loading: boolean;
	companyId: string;
}) {
	const groups = useMemo(() => {
		const map = new Map<string, TargetDeploymentStatus[]>();
		for (const t of targets) {
			const phase = t.action?.phase ?? 'unknown';
			const arr = map.get(phase) ?? [];
			arr.push(t);
			map.set(phase, arr);
		}
		return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({
			phase: g,
			items: map.get(g)!,
		}));
	}, [targets]);

	if (loading) {
		return <p className="py-12 text-center text-sm text-muted-foreground">Carregando dispositivos…</p>;
	}
	if (targets.length === 0) {
		return <Empty title="Sem dispositivos" description="Este deployment não tem alvos." />;
	}

	return (
		<div className="grid gap-4 lg:grid-cols-2">
			{groups.map((g) => (
				<Section
					key={g.phase}
					title={GROUP_LABEL[g.phase] ?? g.phase}
					description={`${g.items.length} dispositivo${g.items.length === 1 ? '' : 's'}`}
				>
					<ul className="divide-y divide-border">
						{g.items.map((t) => (
							<li key={t.controllerId} className="flex items-center gap-2 px-3 py-2">
								<Signal token={phaseSignal(g.phase)} glyphOnly size="sm" />
								<div className="min-w-0 flex-1">
									<Link
										href={`/companies/${companyId}`}
										className="block truncate text-sm font-medium text-foreground hover:text-primary hover:underline"
									>
										{t.name || t.controllerId}
									</Link>
									<Id value={t.controllerId} className="text-[10px] text-muted-foreground" />
									{t.action?.message && t.action.message !== g.phase && (
										<span className="block truncate text-[10px] text-muted-foreground">
											{t.action.message}
										</span>
									)}
								</div>
							</li>
						))}
					</ul>
				</Section>
			))}
		</div>
	);
}
