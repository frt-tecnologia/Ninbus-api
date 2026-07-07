'use client';

import * as React from 'react';
import { format, startOfDay, eachDayOfInterval, isSameDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Section } from '@/components/system';
import { ActivityChart, type ChartBar } from '@/components/system/charts';
import type { EnrichedDeployment } from '@/types/domain';

/**
 * <RolloutActivity> — overview section: deployment activity over time.
 *
 * Buckets rollouts per day WITHIN the selected time window (`from`/`to`,
 * driven by the page's <RangeProvider>). Each day is a hoverable vertical bar.
 * The card reserves its height up front, so the loading skeleton cross-fades
 * into the chart with ZERO layout shift.
 */
export function RolloutActivity({
	deployments,
	loading = false,
	from,
	to,
}: {
	deployments: EnrichedDeployment[];
	loading?: boolean;
	/** Window start (inclusive). Defaults to 14 days ago. */
	from?: Date;
	/** Window end (inclusive). Defaults to now. */
	to?: Date;
}) {
	// Compute the window once (memoized) so the bars effect doesn't re-run every render.
	const window = React.useMemo(() => {
		const start = (from ?? startOfDay(new Date(Date.now() - 13 * 86_400_000))).getTime();
		const end = (to ?? new Date()).getTime();
		return { start: new Date(start), end: new Date(end) };
	}, [from, to]);

	const bars = React.useMemo(
		() => buildBars(deployments, window.start, window.end),
		[deployments, window.start, window.end],
	);
	const total = bars.reduce((s, b) => s + b.value, 0);

	// If the window is ≤ 36 hours, label it as hourly span.
	const byHour = window.end.getTime() - window.start.getTime() <= 36 * 3_600_000;
	const spanLabel = byHour
		? 'janela horária'
		: `${format(window.start, 'dd/MM', { locale: ptBR })}–${format(window.end, 'dd/MM', { locale: ptBR })}`;

	return (
		<Section title="Atividade de rollout" description="Deployments criados no período.">
			<ActivityChart
				bars={bars}
				loading={loading}
				height={168}
				formatValue={(n) => `${n} deployment${n === 1 ? '' : 's'}`}
				emptyLabel="Nenhum deployment no período."
			/>
			<div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
				<span>{spanLabel}</span>
				<span>
					<span className="font-mono tabular-nums text-foreground">{total}</span> deployments
				</span>
			</div>
		</Section>
	);
}

/** Build one ChartBar per day in [from, to], zero-filled, oldest → newest. */
function buildBars(deployments: EnrichedDeployment[], from: Date, to: Date): ChartBar[] {
	const start = startOfDay(from);
	const end = startOfDay(to);
	const days = eachDayOfInterval({ start, end });
	const counts = new Map<string, number>();
	for (const d of days) counts.set(d.toISOString(), 0);

	for (const dep of deployments) {
		const ts = dep.createdAt;
		if (!ts || !Number.isFinite(ts)) continue;
		const date = startOfDay(new Date(ts));
		const matched = days.find((d) => isSameDay(d, date));
		if (matched) {
			const key = matched.toISOString();
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
	}

	return days.map((d) => ({
		label: format(d, 'dd/MM', { locale: ptBR }),
		value: counts.get(d.toISOString()) ?? 0,
	}));
}
