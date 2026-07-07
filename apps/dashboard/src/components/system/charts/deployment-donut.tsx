'use client';

import * as React from 'react';
import { Pie, PieChart, ResponsiveContainer } from 'recharts';
import { cn } from '@/lib/utils';
import type { SignalTone } from '@/lib/design/tokens';
import { TONE_FILL, BRAND_FILL, TONE_TEXT_CLASS, type BrandColor } from './shared';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip';

export interface DonutSegment {
	value: number;
	tone: SignalTone;
	/** Optional brand color override (takes precedence over tone). */
	brand?: BrandColor;
	label: string;
}

/**
 * <DeploymentDonut> — a full-ring donut chart (recharts) that replaces the
 * semicircle gauge. Renders the funnel outcomes (Pendente / Em andamento /
 * Concluído / Falha) as colored arcs around a center readout of the total
 * device count. Unlike the half-gauge, the ring completes a full 360° so every
 * proportion is visible — a tiny slice still shows as a real arc.
 *
 * Signal-tone fills (hsl(var(--signal-*))) keep it theme-aware. The center
 * label uses recharts' <Label> renderer so it tracks the pie geometry. Each
 * segment also has a hoverable legend chip with the percentage.
 *
 * `loading` shows a pulsing ring of equal muted segments in the SAME frame.
 */
export function DeploymentDonut({
	segments,
	loading = false,
	size = 240,
	innerRadius = 62,
	outerRadius = 92,
	centerLabel = 'dispositivos',
	className,
}: {
	segments: DonutSegment[];
	loading?: boolean;
	size?: number;
	innerRadius?: number;
	outerRadius?: number;
	centerLabel?: string;
	className?: string;
}) {
	const total = segments.reduce((s, x) => s + x.value, 0);

	// recharts needs data with a `fill` per slice. Zero-value slices are kept
	// (rendered transparent) so the legend stays complete; the donut is only
	// drawn from positive slices via the `data` filter below.
	const data = segments.map((s) => ({
		label: s.label,
		value: s.value,
		tone: s.tone,
		fill: s.value > 0 ? (s.brand ? BRAND_FILL[s.brand] : TONE_FILL[s.tone]) : 'transparent',
	}));
	const positive = data.filter((d) => d.value > 0);

	return (
		<div className={cn('flex flex-col items-center', className)}>
			<div className="relative" style={{ width: size, height: size }}>
				<ChartShell size={size}>
					<PieChart>
						<Pie
							data={loading ? SKELETON_SLICES : positive.length ? positive : [{ ...data[0], value: 1, fill: 'hsl(var(--muted))' }]}
							dataKey="value"
							nameKey="label"
							innerRadius={innerRadius}
							outerRadius={outerRadius}
							paddingAngle={positive.length > 1 ? 2 : 0}
							stroke="hsl(var(--card))"
							strokeWidth={2}
							isAnimationActive={!loading}
						/>
					</PieChart>
				</ChartShell>

				{/* center readout */}
				<div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
					<span className="font-mono text-3xl font-semibold tabular-nums text-foreground">
						{loading ? '–' : total}
					</span>
					<span className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">
						{centerLabel}
					</span>
				</div>
			</div>

			{/* legend with hover tooltips */}
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
										style={{ background: s.brand ? BRAND_FILL[s.brand] : TONE_FILL[s.tone] }}
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

/** Responsive recharts shell — keeps the SVG square and centered. */
function ChartShell({ size, children }: { size: number; children: React.ReactNode }) {
	return (
		<ResponsiveContainer width={size} height={size}>
			{children as React.ReactElement}
		</ResponsiveContainer>
	);
}

const SKELETON_SLICES = Array.from({ length: 6 }).map(() => ({
	label: '',
	value: 1,
	fill: 'hsl(var(--muted) / 0.5)',
}));
