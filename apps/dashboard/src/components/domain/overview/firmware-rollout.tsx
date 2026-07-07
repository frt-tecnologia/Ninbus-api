'use client';

import * as React from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Section } from '@/components/system';
import { StackedBars, type StackedGroup } from '@/components/system/charts';
import type { Company, EnrichedDeployment } from '@/types/domain';

/**
 * <FirmwareRollout> — overview section replacing the old "FleetPulse" cell grid.
 *
 * Shows, per company, how many devices run the LATEST firmware (Atualizados)
 * vs how many still lag (Pendentes). A grouped stacked bar chart gives the
 * platform-wide picture at a glance; a scrollable per-company breakdown below
 * (with a bottom fade) handles a large fleet. Clicking a bar — or a list row —
 * deep-links to that company. The top-right "Ver detalhes" button opens the
 * deployments tab.
 *
 * Data model: "Atualizados" = Σ finished across the company's rollouts, capped
 * at the company's deviceCount; "Pendentes" = fleet − updated. This is the
 * closest proxy to "running the latest firmware" available without a per-device
 * installed-version field, and it stays congruent with the mass-rollout
 * semantics the user is implementing.
 */

export interface FirmwareRolloutProps {
	companies: Company[];
	/** companyId → that company's deployments (for Σ finished). */
	deploymentsByCompany: Record<string, EnrichedDeployment[]>;
	loading?: boolean;
}

interface Row {
	companyId: string;
	name: string;
	updated: number;
	pending: number;
	total: number;
}

function computeRows(
	companies: Company[],
	byCompany: Record<string, EnrichedDeployment[]>,
): Row[] {
	return companies
		.map((c) => {
			const deps = byCompany[c.id] ?? [];
			const sumFinished = deps.reduce((s, d) => s + (d.statistics?.finished ?? 0), 0);
			const total = Math.max(c.deviceCount ?? 0, 0);
			const updated = Math.min(sumFinished, total);
			return {
				companyId: c.id,
				name: c.name,
				updated,
				pending: Math.max(0, total - updated),
				total,
			};
		})
		.filter((r) => r.total > 0)
		.sort((a, b) => b.pending - a.pending || b.total - a.total);
}

export function FirmwareRollout({
	companies,
	deploymentsByCompany,
	loading = false,
}: FirmwareRolloutProps) {
	const rows = React.useMemo(
		() => computeRows(companies, deploymentsByCompany),
		[companies, deploymentsByCompany],
	);

	const groups: StackedGroup[] = rows.slice(0, 16).map((r) => ({
		label: r.name,
		href: `/companies/${r.companyId}`,
		segments: [
			{ value: r.updated, tone: 'ok', brand: 'lime', label: 'Atualizados' },
			{ value: r.pending, tone: 'idle', brand: 'violet', label: 'Pendentes' },
		],
	}));

	const updatedTotal = rows.reduce((s, r) => s + r.updated, 0);
	const fleetTotal = rows.reduce((s, r) => s + r.total, 0);

	return (
		<Section
			title="Rollout de firmware"
			description="Dispositivos na versão mais recente por empresa."
			action={
				<Button asChild variant="outline" size="sm" className="h-8">
					<Link href="/deployments">
						<ExternalLink className="mr-1.5 h-3.5 w-3.5" />
						Ver detalhes
					</Link>
				</Button>
			}
		>
			<div className="flex flex-col gap-4">
				<StackedBars
					groups={groups}
					loading={loading}
					height={220}
					emptyLabel="Nenhuma empresa com dispositivos."
				/>

				{/* scrollable per-company breakdown with bottom fade */}
				<div className="relative">
					<div
						className="max-h-[40vh] overflow-y-auto pr-1"
						style={{
							maskImage:
								'linear-gradient(to bottom, black calc(100% - 1.75rem), transparent)',
							WebkitMaskImage:
								'linear-gradient(to bottom, black calc(100% - 1.75rem), transparent)',
						}}
					>
						<table className="w-full border-collapse text-sm">
							<thead className="sticky top-0 bg-card">
								<tr className="text-left text-[0.65rem] uppercase tracking-wide text-muted-foreground">
									<th className="py-1.5 font-medium">Empresa</th>
									<th className="py-1.5 text-right font-medium">Atualizados</th>
									<th className="w-1/3 py-1.5 pl-3 font-medium">Proporção</th>
								</tr>
							</thead>
							<tbody>
								{loading
									? Array.from({ length: 4 }).map((_, i) => <Row key={i} row={null} loading />)
									: rows.map((r) => <Row key={r.companyId} row={r} loading={false} />)}
							</tbody>
						</table>
					</div>
				</div>

				<div className="flex items-center justify-between text-xs text-muted-foreground">
					<span>
						<span className="font-mono tabular-nums text-foreground">{updatedTotal}</span>{' '}
						/ {fleetTotal} dispositivos atualizados
					</span>
					<span>
						{fleetTotal > 0
							? `${Math.round((updatedTotal / fleetTotal) * 100)}% da frota`
							: '—'}
					</span>
				</div>
			</div>
		</Section>
	);
}

function Row({ row, loading }: { row: Row | null; loading: boolean }) {
	if (loading || !row) {
		return (
			<tr className="border-t border-border/50">
				<td className="py-2">
					<div className="h-3.5 w-28 animate-pulse rounded bg-muted" />
				</td>
				<td />
				<td className="py-2 pl-3">
					<div className="h-2 w-full animate-pulse rounded bg-muted" />
				</td>
			</tr>
		);
	}
	const pct = row.total > 0 ? (row.updated / row.total) * 100 : 0;
	return (
		<tr className="group border-t border-border/50 transition-colors hover:bg-muted/30">
			<td className="py-2">
				<Link
					href={`/companies/${row.companyId}`}
					className="block truncate font-medium text-foreground group-hover:text-primary group-hover:underline"
				>
					{row.name}
				</Link>
			</td>
			<td className="py-2 text-right font-mono tabular-nums text-muted-foreground">
				<span className="text-signal-ok">{row.updated}</span>
				<span className="text-muted-foreground/50"> / {row.total}</span>
			</td>
			<td className="py-2 pl-3">
				<div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
					<div
						className="h-full bg-signal-ok transition-all duration-500"
						style={{ width: `${pct}%` }}
					/>
				</div>
			</td>
		</tr>
	);
}
