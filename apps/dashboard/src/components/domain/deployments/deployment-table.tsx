'use client';

import type { EnrichedDeployment } from '@/types/domain';
import { deploymentSignal } from '@/lib/design/tokens';
import { DataTable, type Column } from '@/components/data/data-table';
import { Signal, Id, Time } from '@/components/system';
import { cn } from '@/lib/utils';

/**
 * Per-deployment row includes a compact OTA progress segment: finished (ok),
 * in-progress (busy), failed (fault), pending (idle). At-a-glance how each
 * rollout is progressing without a separate detail page.
 */
export function DeploymentTable({
	deployments,
	loading,
	error,
	onRetry,
}: {
	deployments: EnrichedDeployment[];
	loading: boolean;
	error: string | null;
	onRetry: () => void;
}) {
	const columns: Column<EnrichedDeployment>[] = [
		{
			key: 'name',
			header: 'Deployment',
			sortValue: (d) => d.displayName ?? d.name,
			render: (d) => (
				<div className="flex flex-col">
					<span className="text-sm font-medium text-foreground">
						{d.displayName ?? d.name}
					</span>
					{d.artifactName && (
						<Id
							value={`${d.artifactName}${d.artifactVersion ? ` v${d.artifactVersion}` : ''}`}
							className="text-xs text-muted-foreground"
						/>
					)}
				</div>
			),
		},
		{
			key: 'status',
			header: 'Status',
			sortValue: (d) => d.status,
			render: (d) => <Signal token={deploymentSignal(d.status)} size="sm" />,
		},
		{
			key: 'creator',
			header: 'Criado por',
			sortValue: (d) => d.creatorEmail ?? '',
			render: (d) =>
				d.creatorEmail ? (
					<span className="truncate text-xs text-muted-foreground">{d.creatorEmail}</span>
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
				d.createdAt ? <Time value={d.createdAt} /> : <span className="text-muted-foreground">—</span>,
		},
	];

	return (
		<DataTable
			columns={columns}
			rows={deployments}
			rowKey={(d) => String(d.id)}
			loading={loading}
			error={error}
			onRetry={onRetry}
			empty={
				<div className="py-12 text-center text-sm text-muted-foreground">
					Nenhum deployment para esta empresa.
				</div>
			}
		/>
	);
}

function ProgressSegments({ d }: { d: EnrichedDeployment }) {
	const s = d.statistics;
	const total = s.totalTargets || 1;
	const seg = (n: number, cls: string) => (
		<div
			className={cn('h-1.5 rounded-sm', cls)}
			style={{ width: `${(n / total) * 100}%`, minWidth: n > 0 ? '4px' : 0 }}
			title={`${n}`}
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
