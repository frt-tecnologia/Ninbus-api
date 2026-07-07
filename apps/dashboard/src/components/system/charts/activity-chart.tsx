'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { TONE_FILL, BRAND_FILL, safePct, type ChartBar } from './shared';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * <ActivityChart> — a vertical bar chart over a discrete axis (days, weeks…).
 *
 * Designed for the overview's time-series panel: each bar is a period, its
 * height the activity count, its color a SIGNAL tone. Hovering a bar reveals a
 * compact tooltip (period + value). Bars are HTML (not SVG) so Radix Tooltip
 * slots in cleanly and the layout is fully responsive.
 *
 * No-shift loading: the chart always reserves `height` px. While `loading`,
 * skeleton bars fill the SAME frame, so the card never grows/shrinks when data
 * resolves — only a cross-fade.
 */
export function ActivityChart({
	bars,
	loading = false,
	height = 168,
	/** Compact number formatting for the tooltip value (e.g. `n => n+' dp'`). */
	formatValue = (n) => String(n),
	emptyLabel = 'Sem dados no período.',
	className,
}: {
	bars: ChartBar[];
	loading?: boolean;
	height?: number;
	formatValue?: (n: number) => string;
	emptyLabel?: string;
	className?: string;
}) {
	const max = React.useMemo(
		() => Math.max(1, ...bars.map((b) => b.value)),
		[bars],
	);
	const labelEvery = Math.ceil(bars.length / 7); // avoid x-axis label crowding

	return (
		<div className={cn('flex flex-col', className)}>
			<div className="relative" style={{ height }}>
				{/* gridlines (cheap, decorative) */}
				<div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
					{[0, 1, 2, 3].map((i) => (
						<div key={i} className="border-t border-border/40" />
					))}
				</div>

				{loading ? (
					<ChartSkeleton count={Math.max(bars.length, 8)} height={height} />
				) : bars.length === 0 ? (
					<div className="absolute inset-0 flex items-center justify-center">
						<span className="text-xs text-muted-foreground">{emptyLabel}</span>
					</div>
				) : (
					<TooltipProvider delayDuration={120}>
						<div className="relative flex h-full items-end gap-1.5">
							{bars.map((b, i) => {
								const pct = safePct(b.value, max);
								const tone = b.tone ?? 'info';
								return (
									<Tooltip key={`${b.label}-${i}`}>
										<TooltipTrigger asChild>
											<button
												type="button"
												className="group relative flex h-full min-w-0 flex-1 cursor-default items-end justify-center focus:outline-none"
												aria-label={`${b.label}: ${formatValue(b.value)}`}
											>
												<span
													className={cn(
														'w-full max-w-[2.5rem] rounded-t-[3px] transition-all duration-500 ease-out',
														'group-hover:brightness-110',
													)}
													style={{
														height: `${pct}%`,
														minHeight: b.value > 0 ? 3 : 0,
														background:
															b.value > 0 ? (b.tone ? TONE_FILL[tone] : BRAND_FILL.violet) : 'hsl(var(--muted) / 0.4)',
													}}
												/>
											</button>
										</TooltipTrigger>
										<TooltipContent className="max-w-[14rem]">
											<div className="flex flex-col gap-0.5">
												<span className="font-medium">{b.label}</span>
												<span className="font-mono tabular-nums text-muted-foreground">
													{formatValue(b.value)}
												</span>
											</div>
										</TooltipContent>
									</Tooltip>
								);
							})}
						</div>
					</TooltipProvider>
				)}
			</div>

			{/* x-axis labels */}
			{!loading && bars.length > 0 && (
				<div className="mt-1.5 flex gap-1.5">
					{bars.map((b, i) => (
						<div
							key={`${b.label}-x-${i}`}
							className="min-w-0 flex-1 truncate text-center text-[0.6rem] text-muted-foreground/70"
						>
							{i % labelEvery === 0 || i === bars.length - 1 ? b.label : ''}
						</div>
					))}
				</div>
			)}
		</div>
	);
}

/** Skeleton bars that fill the exact same frame as the real chart (no shift). */
function ChartSkeleton({ count, height }: { count: number; height: number }) {
	return (
		<div className="flex h-full items-end gap-1.5" style={{ height }}>
			{Array.from({ length: count }).map((_, i) => {
				// deterministic pseudo-heights so the skeleton looks organic,
				// not uniform — but still occupies the full frame on average.
				const h = 30 + ((i * 37) % 55);
				return (
					<div
						key={i}
						className="flex-1 animate-pulse rounded-t-[3px] bg-muted"
						style={{ height: `${h}%` }}
					/>
				);
			})}
		</div>
	);
}
