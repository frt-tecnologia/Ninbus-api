'use client';

import Link from 'next/link';
import type { EnrichedDeployment } from '@/types/domain';
import { deploymentSignal } from '@/lib/design/tokens';
import { DataTable, type Column } from '@/components/data/data-table';
import { Signal, Id, Time } from '@/components/system';
import { cn } from '@/lib/utils';

const TYPE_LABEL: Record<string, string> = {
	'firmware-ninbus': 'Firmware',
	'configuration-nfx': 'Config NFX',
};

/**
 * <CompanyDeploymentTable> — the rollouts of one company, rendered as an
 * organized, scrollable <DataTable> inside the company-detail page. Each
 * deployment links to its per-device detail page, and a compact progress
 * segment shows finished/in-progress/failed/pending at a glance.
 */
export function CompanyDeploymentTable({
	deployments,
	companyId,
	loading,
	error,
	onRetry,
	maxHeight = '32rem',
}: {
	deployments: EnrichedDeployment[];
	companyId: string;
	loading: boolean;
	error: string | null;
	onRetry: () => void;
	maxHeight?: string;
}) {
	const columns: Column<EnrichedDeployment>[] = [
		{
			key: 'name',
			header: 'Deployment',
			sortValue: (d) => d.displayName ?? d.name,
			render: (d) => <DeploymentName deployment={d} companyId={companyId} />,
		},
		{
			key: 'status',
			header: 'Status',
			sortValue: (d) => d.status,
			render: (d) => <Signal token={deploymentSignal(d.status)} size="sm" />,
		},
		{
			key: 'type',
			header: 'Tipo',
			sortValue: (d) => d.type ?? '',
			render: (d) =>
				d.type ? (
					<span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
						{TYPE_LABEL[d.type] ?? d.type}
					</span>
				) : (
					<span className="text-muted-foreground">—</span>
				),
		},
		{
			key: 'progress',
			header: 'Progresso',
			render: (d) => <ProgressSegments d={d} />,
		},
		{
			key: 'createdAt',
			header: 'Criado',
			sortValue: (d) => d.createdAt ?? 0,
			render: (d) =>
				d.createdAt ? (
					<Time value={d.createdAt} />
				) : (
					<span className="text-muted-foreground">—</span>
				),
		},
	];

	return (
		<div style={{ maxHeight }} className="overflow-auto">
			<DataTable
				columns={columns}
				rows={deployments}
				rowKey={(d) => String(d.id)}
				loading={loading}
				error={error}
				onRetry={onRetry}
				empty={
					<div className="py-10 text-center text-sm text-muted-foreground">
						Nenhuma atualização criada para esta empresa.
					</div>
				}
			/>
		</div>
	);
}

function DeploymentName({
	deployment,
	companyId,
}: {
	deployment: EnrichedDeployment;
	companyId: string;
}) {
	return (
		<div className="flex flex-col">
			<Link
				href={`/deployments/${companyId}/${deployment.id}`}
				className="text-sm font-medium text-foreground hover:text-primary hover:underline"
			>
				{deployment.displayName ?? deployment.name}
			</Link>
			{deployment.artifactName && (
				<Id
					value={`${deployment.artifactName}${
						deployment.artifactVersion ? ` v${deployment.artifactVersion}` : ''
					}`}
					className="text-xs text-muted-foreground"
				/>
			)}
		</div>
	);
}

function ProgressSegments({ d }: { d: EnrichedDeployment }) {
	const s = d.statistics;
	const total = s.totalTargets || 1;
	const seg = (n: number, cls: string) => (
		<div
			className={cn('h-1.5 rounded-sm', cls)}
			style={{ width: `${(n / total) * 100}%`, minWidth: n > 0 ? '4px' : 0 }}
		/>
	);
	return (
		<div className="flex items-center gap-2">
			<div className="flex h-1.5 w-28 overflow-hidden rounded-sm bg-muted">
				{seg(s.finished, 'bg-signal-ok')}
				{seg(s.inProgress, 'bg-signal-busy')}
				{seg(s.failed, 'bg-signal-fault')}
				{seg(s.pending, 'bg-signal-idle/40')}
			</div>
			<span className="font-mono text-xs tabular-nums text-muted-foreground">
				{s.finished}/{s.totalTargets}
			</span>
		</div>
	);
}
