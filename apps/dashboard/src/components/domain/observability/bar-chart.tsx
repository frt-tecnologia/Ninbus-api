'use client';

import { cn } from '@/lib/utils';
import * as React from 'react';

/**
 * <BarChart> — lightweight SVG bar chart (histogram / distribution).
 *
 * No chart dependency. Encodes the domain: compact vertical bars over a
 * time or ordinal x-axis, value-scaled, with hover titles. Used by the
 * overview for the daily-online histogram and the update-hour distribution.
 *
 * Presentational + responsive (ResizeObserver for width).
 */
export interface BarChartDatum {
	/** x-axis label (e.g. "2026-07-01" or "14"). */
	label: string;
	/** bar height value. */
	value: number;
}

export interface BarChartProps {
	data: BarChartDatum[];
	/** Bar fill Tailwind class (e.g. 'fill-signal-ok'). */
	fillClass?: string;
	/** Force the y-axis max (defaults to max datum value). */
	yMax?: number;
	height?: number;
	className?: string;
	/** Compact: hides x-axis labels (use when there are many bars). */
	compact?: boolean;
}

const DEFAULT_HEIGHT = 120;
const MIN_WIDTH = 280;

export function BarChart({
	data,
	fillClass = 'fill-signal-info',
	yMax,
	height = DEFAULT_HEIGHT,
	className,
	compact,
}: BarChartProps) {
	const containerRef = React.useRef<HTMLDivElement>(null);
	const [width, setWidth] = React.useState(MIN_WIDTH);
	React.useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const ro = new ResizeObserver((entries) => {
			for (const e of entries) setWidth(Math.max(e.contentRect.width, MIN_WIDTH));
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const max = yMax ?? Math.max(1, ...data.map((d) => d.value));
	const n = Math.max(data.length, 1);
	const gap = data.length > 24 ? 1 : 3;
	const barW = Math.max((width - gap * (n - 1)) / n, 2);
	const axisH = compact ? 0 : 16;
	const plotH = height - axisH;

	if (data.length === 0) {
		return (
			<div
				ref={containerRef}
				className={cn('flex items-center justify-center text-xs text-muted-foreground', className)}
				style={{ height }}
			>
				Sem dados no período.
			</div>
		);
	}

	// Show ~6 x-axis labels (evenly spaced).
	const labelEvery = Math.max(1, Math.ceil(n / 6));

	return (
		<div ref={containerRef} className={cn('w-full', className)}>
			<svg
				width={width}
				height={height}
				className="block"
				style={{ minWidth: MIN_WIDTH }}
				role="img"
				aria-label="Gráfico de barras"
			>
				{data.map((d, i) => {
					const h = (d.value / max) * plotH;
					const x = i * (barW + gap);
					const y = plotH - h;
					return (
						<g key={`bar-${i}`}>
							<rect
								x={x}
								y={y}
								width={barW}
								height={Math.max(h, d.value > 0 ? 1 : 0)}
								rx={1}
								className={fillClass}
							>
								<title>{`${d.label}: ${d.value}`}</title>
							</rect>
							{!compact && i % labelEvery === 0 && (
								<text
									x={x + barW / 2}
									y={height - 4}
									textAnchor="middle"
									className="fill-muted-foreground"
									style={{ fontSize: 9 }}
								>
									{d.label.length > 5 ? d.label.slice(5) : d.label}
								</text>
							)}
						</g>
					);
				})}
			</svg>
		</div>
	);
}
