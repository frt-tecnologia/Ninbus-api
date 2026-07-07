'use client';

import { useCallback, useMemo, useState } from 'react';
import { Package, Cpu, Settings2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Section } from '@/components/system';
import { DeploymentDonut, type DonutSegment } from '@/components/system/charts';
import { DeploymentTable } from '@/components/domain/deployments/deployment-table';
import { CompanyPicker } from '@/components/domain/deployments/company-picker';
import { useFetch } from '@/hooks/useFetch';
import { useAllDeployments } from '@/hooks/use-all-deployments';
import { companyService } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Deployments — observability of OTA rollouts.
 *
 * The funnel is a full-ring donut (recharts <DeploymentDonut>) conveying the
 * four outcomes (Pendente · Em andamento · Concluído · Falha) with the total
 * device count in the center. Beside it:
 *  - <CompanyPicker> — aggregate (all) or a single company
 *  - Type filter — Firmware Ninbus / Configuração NFX / Todos, so the two
 *    rollout kinds (high-risk reboot firmware vs low-risk CAN config) can be
 *    inspected in isolation.
 * The table mirrors both selections. No redundant stat cards — the donut +
 * legend already carry the counts.
 */

/** funnel stages → donut segments.
 *  Color separation matters: Pendente vs Concluído must be visually distinct.
 *  Pendente → violet (waiting), Em andamento → lime (active),
 *  Concluído → signal-ok GREEN (success — a different HUE from lime so it
 *  never reads as "also pending"), Falha → red.
 */
const SEGMENTS: Array<{ key: keyof Funnel; tone: DonutSegment['tone']; brand?: DonutSegment['brand']; label: string }> = [
	{ key: 'pending', tone: 'idle', brand: 'violet', label: 'Pendente' },
	{ key: 'inProgress', tone: 'busy', brand: 'lime', label: 'Em andamento' },
	{ key: 'finished', tone: 'ok', label: 'Concluído' },
	{ key: 'failed', tone: 'fault', label: 'Falha' },
];

/** Rollout-type filters. `type` on a deployment maps to the DS module type. */
type TypeFilter = 'all' | 'firmware-ninbus' | 'configuration-nfx';
const TYPE_OPTIONS: { value: TypeFilter; label: string; icon: typeof Cpu }[] = [
	{ value: 'all', label: 'Todos os tipos', icon: Package },
	{ value: 'firmware-ninbus', label: 'Firmware Ninbus', icon: Cpu },
	{ value: 'configuration-nfx', label: 'Configuração NFX', icon: Settings2 },
];

interface Funnel {
	pending: number;
	inProgress: number;
	finished: number;
	failed: number;
}

export default function DeploymentsPage() {
	const companies = useFetch(useCallback(() => companyService.list(), []));
	const companyList = useMemo(() => companies.data?.data ?? [], [companies.data]);
	const companyNameById = useMemo(
		() => Object.fromEntries(companyList.map((c) => [c.id, c.name])),
		[companyList],
	);

	const all = useAllDeployments(companyList);

	const [companyId, setCompanyId] = useState<string>(''); // '' = all (grouped)
	const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
	const isAll = companyId === '';

	// Apply company + type filters.
	const filtered = useMemo(() => {
		let rows = isAll ? all.deployments : all.deployments.filter((d) => d.companyId === companyId);
		if (typeFilter !== 'all') {
			rows = rows.filter((d) => d.type === typeFilter);
		}
		return rows;
	}, [all.deployments, companyId, isAll, typeFilter]);

	const funnel = useMemo<Funnel>(() => {
		const f: Funnel = { pending: 0, inProgress: 0, finished: 0, failed: 0 };
		for (const d of filtered) {
			const s = d.statistics;
			f.pending += s?.pending ?? 0;
			f.inProgress += s?.inProgress ?? 0;
			f.finished += s?.finished ?? 0;
			f.failed += s?.failed ?? 0;
		}
		return f;
	}, [filtered]);

	const segments: DonutSegment[] = SEGMENTS.map((g) => ({
		value: funnel[g.key],
		tone: g.tone,
		brand: g.brand,
		label: g.label,
	}));

	const description = isAll
		? 'Soma de dispositivos por estágio em todas as empresas.'
		: `Soma de dispositivos por estágio — ${companyNameById[companyId] ?? ''}.`;

	return (
		<>
			<PageHeader
				title="Deployments"
				description="Observabilidade das atualizações OTA por empresa."
			/>

			<Section title="Funil de atualização" description={description} className="mb-4">
				<div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_18rem] md:items-center">
					<DeploymentDonut
						segments={segments}
						loading={all.loading}
						centerLabel="dispositivos"
						size={240}
					/>

					<aside className="flex flex-col gap-4">
						<div>
							<label className="mb-1.5 block text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
								Empresa
							</label>
							<CompanyPicker
								companies={companyList}
								value={companyId}
								onChange={setCompanyId}
								loading={companies.loading}
							/>
						</div>
						<div>
							<label className="mb-1.5 block text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
								Tipo de atualização
							</label>
							<div className="flex flex-col gap-1.5">
								{TYPE_OPTIONS.map((opt) => {
									const active = typeFilter === opt.value;
									const Icon = opt.icon;
									return (
										<button
											key={opt.value}
											type="button"
											onClick={() => setTypeFilter(opt.value)}
											className={cn(
												'flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors',
												active
													? 'border-primary/40 bg-primary/10 text-foreground'
													: 'border-border bg-background/40 text-muted-foreground hover:bg-muted/40',
											)}
										>
											<Icon className="h-4 w-4 shrink-0" />
											{opt.label}
										</button>
									);
								})}
							</div>
						</div>
					</aside>
				</div>
			</Section>

			<DeploymentTable
				deployments={filtered}
				companyId={isAll ? undefined : companyId}
				showCompany={isAll}
				companyNameById={companyNameById}
				loading={all.loading}
				error={all.error}
				onRetry={all.refetch}
			/>
		</>
	);
}
