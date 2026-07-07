'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { SignalTone } from '@/lib/design/tokens';
import { describeArc, TONE_FILL, TONE_TEXT_CLASS } from './shared';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip';

export interface GaugeSegment {
	value: number;
	tone: SignalTone;
	label: string;
}

/**
 * <Gauge> — a semicircle (half-doughnut) gauge.
 *
 * Replaces the linear "update funnel" with a single arc that conveys the
 * proportion of pending / in-progress / concluded / failed in one glance.
 * Each colored arc segment has a matching legend chip that is independently
 * hoverable for a percentage tooltip. The center reads the total. Pure SVG so
 * it scales crisply and inherits signal tokens.
 *
 * Angle math: 180° (left) → 0° (right), clockwise over the dome. See
 * `describeArc` / `polarToCartesian` in ./shared. Segments whose span collapses
 * below the inter-segment gap are skipped (avoids inverted arc paths for
 * near-zero values).
 */
export function Gauge({
	segments,
	loading = false,
	size = 220,
	stroke = 22,
	totalLabel = 'Total',
	centerValue,
	className,
}: {
	segments: GaugeSegment[];
	loading?: boolean;
	size?: number;
	/** Band thickness (px). */
	stroke?: number;
	totalLabel?: string;
	/** Override the big center number (defaults to sum of segments). */
	centerValue?: number | string;
	className?: string;
}) {
	const total = segments.reduce((s, x) => s + x.value, 0);
	const cx = size / 2;
	const cy = size / 2;
	const r = size / 2 - stroke / 2 - 2;
	const GAP = segments.length > 1 ? 2.2 : 0; // degrees between segments

	// Pre-compute segment angle ranges (180 → 0, descending).
	const arcs = React.useMemo(() => {
		if (total <= 0) return [];
		let cursor = 180;
		return segments.map((seg) => {
			const span = (seg.value / total) * 180;
			const start = Math.max(0, cursor - GAP / 2);
			const end = Math.min(180, cursor - span + GAP / 2);
			cursor -= span;
			return { seg, start, end };
		});
	}, [segments, total, GAP]);

	const showTotal = centerValue ?? total;
	const h = size / 2 + 14;

	return (
		<div className={cn('flex flex-col items-center', className)}>
			<div className="relative" style={{ width: size, height: h }}>
				<svg viewBox={`0 0 ${size} ${h}`} width={size} height={h} role="img" aria-label={totalLabel}>
					{/* background track */}
					<path
						d={describeArc(cx, cy, r, 180, 0)}
						fill="none"
						stroke="hsl(var(--muted))"
						strokeWidth={stroke}
						strokeLinecap="round"
					/>
					{/* segments — skip ones whose span collapses below the gap */}
					{!loading &&
						total > 0 &&
						arcs.map((a, i) =>
							a.start - a.end > 0.4 ? (
								<path
									key={`${a.seg.label}-${i}`}
									d={describeArc(cx, cy, r, a.start, a.end)}
									fill="none"
									stroke={TONE_FILL[a.seg.tone]}
									strokeWidth={stroke}
									strokeLinecap="butt"
									className="transition-all duration-500"
									style={{ opacity: a.seg.value > 0 ? 1 : 0 }}
								/>
							) : null,
						)}
					{loading && (
						<path
							d={describeArc(cx, cy, r, 180, 0)}
							fill="none"
							stroke="hsl(var(--muted))"
							strokeWidth={stroke}
							strokeLinecap="round"
							className="animate-pulse"
						/>
					)}
				</svg>

				{/* center readout */}
				<div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center">
					<span className="font-mono text-3xl font-semibold tabular-nums text-foreground">
						{showTotal}
					</span>
					<span className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">
						{totalLabel}
					</span>
				</div>
			</div>

			{/* legend with hover tooltips (also the hit-area fallback for touch) */}
			<TooltipProvider delayDuration={120}>
				<div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
					{segments.map((s, i) => (
						<Tooltip key={`${s.label}-${i}`}>
							<TooltipTrigger asChild>
								<button
									type="button"
									className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[0.7rem] text-muted-foreground hover:bg-muted/50"
								>
									<span
										className="inline-block h-2 w-2 rounded-[2px]"
										style={{ background: TONE_FILL[s.tone] }}
									/>
									{s.label}
									<span className={cn('font-mono tabular-nums', TONE_TEXT_CLASS[s.tone])}>
										{s.value}
									</span>
								</button>
							</TooltipTrigger>
							<TooltipContent>
								<span className="font-medium">{s.label}</span>
								<span className="ml-1 font-mono text-muted-foreground">
									{total > 0 ? Math.round((s.value / total) * 100) : 0}%
								</span>
							</TooltipContent>
						</Tooltip>
					))}
				</div>
			</TooltipProvider>
		</div>
	);
}
