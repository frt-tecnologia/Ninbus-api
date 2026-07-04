'use client';

import { useCallback, useMemo, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Section, Pipeline } from '@/components/system';
import { DeploymentTable } from '@/components/domain/deployments/deployment-table';
import { useFetch } from '@/hooks/useFetch';
import { companyService, deploymentService } from '@/lib/api';
import type { PipelineStage } from '@/lib/design/tokens';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';

/**
 * Aggregate OTA funnel across the selected company's deployments, plus the
 * per-deployment table. The funnel (Pendente → Em andamento → Concluído →
 * Falha) is the signature overview of rollout health — what OTA means.
 */
const FUNNEL: PipelineStage[] = [
	{ phase: 'pending', tone: 'busy', label: 'Pendente' },
	{ phase: 'inProgress', tone: 'info', label: 'Em andamento' },
	{ phase: 'finished', tone: 'ok', label: 'Concluído' },
	{ phase: 'failed', tone: 'fault', label: 'Falha' },
];

export default function DeploymentsPage() {
	const companies = useFetch(useCallback(() => companyService.list(), []));
	const [companyId, setCompanyId] = useState<string>('');
	const active = companyId || companies.data?.data[0]?.id || '';
	const deployments = useFetch(
		useCallback(
			() =>
				active
					? deploymentService.list(active)
					: Promise.resolve({ data: [], total: 0 }),
			[active],
		),
		[active],
	);

	const funnel = useMemo(() => {
		const counts: Record<string, number> = { pending: 0, inProgress: 0, finished: 0, failed: 0 };
		for (const d of deployments.data?.data ?? []) {
			counts.pending += d.statistics.pending;
			counts.inProgress += d.statistics.inProgress;
			counts.finished += d.statistics.finished;
			counts.failed += d.statistics.failed;
		}
		return counts;
	}, [deployments.data]);

	return (
		<>
			<PageHeader
				title="Deployments"
				description="Observabilidade das atualizações OTA por empresa."
			/>
			<Section
				title="Funil de atualização"
				description="Soma de dispositivos por estágio em todos os rollouts da empresa."
				className="mb-4"
				action={
					<Select value={active} onValueChange={setCompanyId}>
						<SelectTrigger className="h-8 w-48">
							<SelectValue placeholder="Empresa" />
						</SelectTrigger>
						<SelectContent>
							{(companies.data?.data ?? []).map((c) => (
								<SelectItem key={c.id} value={c.id}>
									{c.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				}
			>
				<Pipeline counts={funnel} stages={FUNNEL} />
			</Section>

			<DeploymentTable
				deployments={deployments.data?.data ?? []}
				companyId={active}
				loading={deployments.loading}
				error={deployments.error}
				onRetry={deployments.refetch}
			/>
		</>
	);
}
