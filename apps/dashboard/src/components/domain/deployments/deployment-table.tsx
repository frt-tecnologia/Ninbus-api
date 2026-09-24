'use client';

import Link from 'next/link';
import { type Column, DataTable } from '@/components/data/data-table';
import { Id, Signal, Time } from '@/components/system';
import { deploymentSignal } from '@/lib/design/tokens';
import { cn } from '@/lib/utils';
import type { EnrichedDeployment } from '@/types/domain';

const TYPE_LABEL: Record<string, string> = {
	'firmware-ninbus': 'Firmware',
	'configuration-nfx': 'Config NFX',
};

/**
 * Per-deployment row includes a compact OTA progress segment: finished (ok),
 * in-progress (busy), failed (fault), pending (idle). The deployment name
 * links to its detail page (per-device outcome). At-a-glance how each rollout
 * is progressing without a separate detail page.
 *
 * In "all companies" mode (`showCompany`), a company column is prepended so the
 * cross-company view stays navigable — each cell links to that company.
 */
export function DeploymentTable({
	deployments,
	companyId,
	/** Show a per-row company column (cross-company / "all" view). */
	showCompany = false,
	/** companyId → name, used to render the company column in "all" mode. */
	companyNameById,
	loading,
	error,
	onRetry,
}: {
	deployments: EnrichedDeployment[];
	/** Company context so each deployment name links to its detail page. */
	companyId?: string;
	showCompany?: boolean;
	companyNameById?: Record<string, string>;
	loading: boolean;
	error: string | null;
	onRetry: () => void;
}) {
	const columns: Column<EnrichedDeployment>[] = [];
	if (showCompany) {
		columns.push({
			key: 'company',
			header: 'Empresa',
			sortValue: (d) => d.companyId ?? '',
			render: (d) => <CompanyCell id={d.companyId} names={companyNameById} />,
		});
	}
	columns.push(
		{
			key: 'name',
			header: 'Deployment',
			sortValue: (d) => d.displayName ?? d.name,
			render: (d) => <DeploymentName deployment={d} companyId={d.companyId ?? companyId} />,
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
	);

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

/** Company column cell — links to the company page, shows the name if known. */
function CompanyCell({ id, names }: { id?: string; names?: Record<string, string> }) {
	if (!id) return <span className="text-muted-foreground">—</span>;
	return (
		<Link
			href={`/companies/${id}`}
			className="text-sm text-muted-foreground hover:text-primary hover:underline"
		>
			<span className="truncate">{names?.[id] ?? 'Empresa'}</span>
		</Link>
	);
}

/** Deployment name — a Link to the detail page when companyId is known. */
function DeploymentName({
	deployment,
	companyId,
}: {
	deployment: EnrichedDeployment;
	companyId?: string;
}) {
	const name = deployment.displayName ?? deployment.name;
	const inner = <span className="text-sm font-medium text-foreground">{name}</span>;
	return (
		<div className="flex flex-col">
			{companyId ? (
				<Link
					href={`/deployments/${companyId}/${deployment.id}`}
					className="hover:text-primary hover:underline"
				>
					{inner}
				</Link>
			) : (
				inner
			)}
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
