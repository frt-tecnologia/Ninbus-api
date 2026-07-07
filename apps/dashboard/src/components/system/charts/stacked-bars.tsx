'use client';

import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { SignalTone } from '@/lib/design/tokens';
import { TONE_FILL, BRAND_FILL, type BrandColor } from './shared';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip';

/** One segment of a stacked column (e.g. "Atualizados", "Pendentes"). */
export interface StackedSegment {
	value: number;
	tone: SignalTone;
	/** Optional brand color override (takes precedence over tone fill). */
	brand?: BrandColor;
	label: string;
}

/** One column (e.g. a company) with stacked segments + optional deep link. */
export interface StackedGroup {
	label: string;
	segments: StackedSegment[];
	/** When set, the whole column becomes a <Link> to this href. */
	href?: string;
}

/**
 * <StackedBars> — grouped vertical stacked bars.
 *
 * Each group is a column (x-axis = companies); segments stack from the bottom
 * (e.g. green "updated" under neutral "pending"). Hovering a column reveals a
 * full breakdown tooltip; clicking navigates to `href`.
 *
 * Built for the fleet firmware-rollout view: at a glance which companies are
 * fully updated vs lagging. Bars are HTML for clean Tooltip + responsive
 * layout. A loading skeleton fills the identical frame (no layout shift).
 */
export function StackedBars({
	groups,
	loading = false,
	height = 200,
	maxOverride,
	emptyLabel = 'Sem dados.',
	onGroupClick,
	className,
}: {
	groups: StackedGroup[];
	loading?: boolean;
	height?: number;
	/** Pin the y-axis max. Defaults to the tallest column. */
	maxOverride?: number;
	emptyLabel?: string;
	onGroupClick?: (g: StackedGroup, index: number) => void;
	className?: string;
}) {
	const max = React.useMemo(() => {
		if (maxOverride && maxOverride > 0) return maxOverride;
		return Math.max(1, ...groups.map((g) => g.segments.reduce((s, x) => s + x.value, 0)));
	}, [groups, maxOverride]);

	return (
		<div className={cn('flex flex-col', className)}>
			<div className="relative" style={{ height }}>
				{/* gridlines */}
				<div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
					{[0, 1, 2, 3].map((i) => (
						<div key={i} className="border-t border-border/40" />
					))}
				</div>

				{loading ? (
					<BarsSkeleton count={Math.max(groups.length, 4)} height={height} />
				) : groups.length === 0 ? (
					<div className="absolute inset-0 flex items-center justify-center">
						<span className="text-xs text-muted-foreground">{emptyLabel}</span>
					</div>
				) : (
					<TooltipProvider delayDuration={120}>
						<div className="relative flex h-full items-end gap-2">
							{groups.map((g, gi) => {
								const total = g.segments.reduce((s, x) => s + x.value, 0);
								const fillPct = Math.min(100, (total / max) * 100);
								const clickable = Boolean(g.href || onGroupClick);
								// The growth + layout class lives on the trigger element so the
								// column always fills its flex track whether or not it is a link.
								const colClass = cn(
									'relative flex h-full min-w-0 flex-1 flex-col justify-end',
									clickable && 'cursor-pointer',
								);

								const bar = (
									<div
										className="mx-auto flex w-full max-w-[3rem] flex-col-reverse overflow-hidden rounded-t-md transition-all duration-500 ease-out"
										style={{ height: `${fillPct}%`, minHeight: total > 0 ? 4 : 0 }}
									>
										{g.segments.map((seg, si) => {
											const segPct = total > 0 ? (seg.value / total) * 100 : 0;
											return (
												<div
													key={`${seg.label}-${si}`}
													className="w-full transition-all duration-500"
													style={{
														height: `${segPct}%`,
														background: seg.value > 0 ? (seg.brand ? BRAND_FILL[seg.brand] : TONE_FILL[seg.tone]) : 'transparent',
													}}
												/>
											);
										})}
									</div>
								);

								const trigger = g.href ? (
									<Link
										href={g.href}
										className={colClass}
										onClick={() => onGroupClick?.(g, gi)}
									>
										{bar}
									</Link>
								) : onGroupClick ? (
									<button
										type="button"
										className={cn(colClass, 'bg-transparent p-0')}
										onClick={() => onGroupClick?.(g, gi)}
									>
										{bar}
									</button>
								) : (
									<div className={colClass}>{bar}</div>
								);

								return (
									<Tooltip key={`${g.label}-${gi}`}>
										<TooltipTrigger asChild>{trigger}</TooltipTrigger>
										<TooltipContent className="max-w-[16rem]">
											<div className="flex flex-col gap-1">
												<span className="text-xs font-semibold text-foreground">
													{g.label}
												</span>
												{g.segments
													.filter((s) => s.value > 0)
													.map((s, si) => (
														<div
															key={`${s.label}-${si}`}
															className="flex items-center justify-between gap-3 text-[0.7rem]"
														>
															<span className="flex items-center gap-1.5 text-muted-foreground">
																<span
																	className="inline-block h-2 w-2 rounded-[2px]"
																	style={{ background: s.brand ? BRAND_FILL[s.brand] : TONE_FILL[s.tone] }}
																/>
																{s.label}
															</span>
															<span className="font-mono tabular-nums text-foreground">
																{s.value}
															</span>
														</div>
													))}
												<div className="mt-0.5 flex items-center justify-between border-t border-border pt-1 text-[0.7rem]">
													<span className="text-muted-foreground">Total</span>
													<span className="font-mono font-semibold tabular-nums">
														{total}
													</span>
												</div>
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
			{!loading && groups.length > 0 && (
				<div className="mt-1.5 flex gap-2">
					{groups.map((g, i) => (
						<div
							key={`${g.label}-x-${i}`}
							className="min-w-0 flex-1 truncate text-center text-[0.6rem] text-muted-foreground/70"
							title={g.label}
						>
							{g.label}
						</div>
					))}
				</div>
			)}
		</div>
	);
}

/** Skeleton columns occupying the identical frame (no shift on resolve). */
function BarsSkeleton({ count, height }: { count: number; height: number }) {
	return (
		<div className="flex h-full items-end gap-2" style={{ height }}>
			{Array.from({ length: count }).map((_, i) => {
				const h = 35 + ((i * 29) % 55);
				return (
					<div
						key={i}
						className="mx-auto w-full max-w-[3rem] flex-1 animate-pulse rounded-t-md bg-muted"
						style={{ height: `${h}%` }}
					/>
				);
			})}
		</div>
	);
}
