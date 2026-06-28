'use client';

import { useMemo, useState, useCallback } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Select } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { StatusBadge } from '@/components/ui/Badge';
import { deploymentStatusMeta, formatDateTime } from '@/lib/utils';
import { EmptyState, ErrorState } from '@/components/ui/State';
import { useFetch } from '@/hooks/useFetch';
import { companyService, deploymentService } from '@/lib/api';
import type { EnrichedDeployment, Company } from '@/types/domain';
import { Download, CheckCircle2, XCircle, Clock } from 'lucide-react';

export default function DeploymentsPage() {
	const companies = useFetch(useCallback(() => companyService.list(), []));
	const [companyId, setCompanyId] = useState<string>('');

	const activeCompany = companyId || companies.data?.data[0]?.id || '';
	const deployments = useFetch(
		useCallback(
			() =>
				activeCompany ? deploymentService.list(activeCompany) : Promise.resolve({ data: [], total: 0 }),
			[activeCompany],
		),
		[activeCompany],
	);

	const columns: Column<EnrichedDeployment>[] = [
		{
			key: 'name',
			header: 'Deployment',
			sortable: true,
			sortValue: (d) => d.displayName ?? d.name,
			render: (d) => (
				<div>
					<div className="font-medium text-gray-900">{d.displayName ?? d.name}</div>
					{d.artifactName && (
						<div className="text-xs text-gray-400">
							{d.artifactName}
							{d.artifactVersion ? ` v${d.artifactVersion}` : ''}
						</div>
					)}
				</div>
			),
		},
		{
			key: 'status',
			header: 'Status',
			sortable: true,
			sortValue: (d) => d.status,
			render: (d) => <StatusBadge meta={deploymentStatusMeta(d.status)} />,
		},
		{
			key: 'targets',
			header: 'Dispositivos',
			sortable: true,
			sortValue: (d) => d.statistics.totalTargets,
			render: (d) => (
				<div className="flex items-center gap-3 text-xs">
					<span className="flex items-center gap-1 text-green-600" title="Concluídos">
						<CheckCircle2 className="h-3 w-3" />
						{d.statistics.finished}
					</span>
					<span className="flex items-center gap-1 text-blue-600" title="Em andamento">
						<Clock className="h-3 w-3" />
						{d.statistics.inProgress + d.statistics.pending}
					</span>
					<span className="flex items-center gap-1 text-red-600" title="Falhas">
						<XCircle className="h-3 w-3" />
						{d.statistics.failed}
					</span>
					<span className="text-gray-400">/ {d.statistics.totalTargets}</span>
				</div>
			),
		},
		{
			key: 'createdAt',
			header: 'Criado em',
			sortable: true,
			sortValue: (d) => d.createdAt ?? 0,
			render: (d) => (
				<span className="text-gray-500">
					{d.createdAt ? formatDateTime(new Date(d.createdAt * 1000).toISOString()) : '—'}
				</span>
			),
		},
	];

	return (
		<>
			<PageHeader
				title="Deployments"
				description="Observabilidade das atualizações OTA. Selecione uma empresa para ver seus deployments e o status de cada dispositivo."
			/>
			<div className="mb-4 flex items-center gap-3">
				<label htmlFor="company" className="text-sm font-medium text-gray-700">
					Empresa:
				</label>
				<Select
					id="company"
					value={activeCompany}
					onChange={(e) => setCompanyId(e.target.value)}
					className="w-auto"
				>
					{(companies.data?.data ?? []).map((c: Company) => (
						<option key={c.id} value={c.id}>
							{c.name}
						</option>
					))}
				</Select>
			</div>

			{deployments.error ? (
				<ErrorState message={deployments.error} onRetry={deployments.refetch} />
			) : (
				<div className="rounded-xl border border-gray-200 bg-white">
					<DataTable
						columns={columns}
						rows={deployments.data?.data ?? []}
						rowKey={(d) => String(d.id)}
						loading={deployments.loading}
						emptyState={
							<EmptyState
								title="Nenhum deployment"
								description="Esta empresa ainda não criou atualizações OTA."
							/>
						}
					/>
				</div>
			)}
			<p className="mt-3 text-xs text-gray-400">
				💡 A timeline detalhada por dispositivo (download, instalação, sucesso/falha,
				quem aplicou) está disponível via o endpoint de status-trail da API e será
				exposta na próxima iteração do dashboard.
			</p>
		</>
	);
}
