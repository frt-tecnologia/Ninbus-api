'use client';

import { Empty } from '@/components/system';
import type { SessionBand } from '@/lib/api/observability';
import { cn } from '@/lib/utils';
import * as React from 'react';

/**
 * <ConnectionTimeline> — the SIGNATURE observability visual.
 *
 * Each device = one horizontal lane (eixo y). Each online session = a filled
 * band spanning its [start → end] on the time axis (eixo x). Empty lane =
 * offline/unknown. This reads as a telemetry strip (coherent with the
 * `Signal` design language) and is genuinely useful for OTA fleet health —
 * you see exactly WHEN each device was online within the selected window.
 *
 * Built as bespoke lightweight SVG (no chart dependency) so it encodes the
 * domain instead of looking like a generic template scatter chart.
 *
 * Props are fully declarative (presentational) — the container fetches data.
 */
export interface ConnectionTimelineProps {
	sessions: SessionBand[];
	from: Date;
	to: Date;
	/** When set, the matching lane is highlighted and scrolled into view. */
	focusedDeviceId?: string | null;
	loading?: boolean;
	className?: string;
}

const LANE_HEIGHT = 22;
const LANE_GAP = 4;
const AXIS_HEIGHT = 22;
const MIN_WIDTH = 320;
const BAND_FILL = 'fill-signal-ok';
const BAND_FILL_FOCUS = 'fill-signal-ok';

export function ConnectionTimeline({
	sessions,
	from,
	to,
	focusedDeviceId,
	loading,
	className,
}: ConnectionTimelineProps) {
	const total = to.getTime() - from.getTime();

	// Group sessions by device to build lanes (preserve first-seen order).
	const lanes = React.useMemo(() => {
		const order: string[] = [];
		const map = new Map<string, { deviceId: string; name: string; bands: SessionBand[] }>();
		for (const s of sessions) {
			let lane = map.get(s.deviceId);
			if (!lane) {
				lane = {
					deviceId: s.deviceId,
					name: s.deviceName ?? s.hawkbitTargetId ?? s.deviceId,
					bands: [],
				};
				map.set(s.deviceId, lane);
				order.push(s.deviceId);
			}
			lane.bands.push(s);
		}
		return order.map((id) => map.get(id)!);
	}, [sessions]);

	// Responsive width via ResizeObserver; height derives from lane count.
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

	const chartHeight = lanes.length * (LANE_HEIGHT + LANE_GAP) + AXIS_HEIGHT;
	const plotHeight = chartHeight - AXIS_HEIGHT;

	const xFor = (ts: number): number => {
		const ratio = (ts - from.getTime()) / total;
		return Math.max(0, Math.min(width, ratio * width));
	};

	// Time axis ticks (~5 evenly spaced).
	const ticks = React.useMemo(() => {
		const count = 5;
		const out: { x: number; label: string }[] = [];
		for (let i = 0; i <= count; i++) {
			const t = from.getTime() + (total * i) / count;
			out.push({
				x: xFor(t),
				label: new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
			});
		}
		return out;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [from, to, width]);

	if (loading) {
		return (
			<div
				ref={containerRef}
				className={cn('flex min-h-[120px] items-center justify-center', className)}
			>
				<div className="h-2 w-24 animate-pulse rounded bg-secondary" />
			</div>
		);
	}

	if (lanes.length === 0) {
		return (
			<div
				ref={containerRef}
				className={cn('flex min-h-[120px] items-center justify-center', className)}
			>
				<Empty description="Nenhuma sessão de conexão no período selecionado." />
			</div>
		);
	}

	return (
		<div ref={containerRef} className={cn('w-full overflow-hidden', className)}>
			<svg
				role="img"
				aria-label="Linha do tempo de conexão dos dispositivos"
				width={width}
				height={chartHeight}
				className="block"
				style={{ minWidth: MIN_WIDTH }}
			>
				{/* Time axis */}
				<g>
					{ticks.map((tk, i) => (
						<g key={`tick-${i}`}>
							<line
								x1={tk.x}
								y1={0}
								x2={tk.x}
								y2={plotHeight}
								stroke="currentColor"
								className="text-border"
								strokeWidth={1}
								strokeDasharray={i === 0 || i === ticks.length - 1 ? undefined : '2 4'}
							/>
							<text
								x={tk.x}
								y={chartHeight - 6}
								textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}
								className="fill-muted-foreground"
								style={{ fontSize: 10 }}
							>
								{tk.label}
							</text>
						</g>
					))}
				</g>

				{/* Lanes + session bands */}
				{lanes.map((lane, li) => {
					const y = li * (LANE_HEIGHT + LANE_GAP) + LANE_GAP;
					const isFocused = focusedDeviceId === lane.deviceId;
					return (
						<g key={lane.deviceId} className={isFocused ? undefined : 'opacity-90'}>
							{/* lane background */}
							<rect
								x={0}
								y={y}
								width={width}
								height={LANE_HEIGHT}
								rx={3}
								className={isFocused ? 'fill-secondary' : 'fill-transparent'}
							/>
							{/* device label (truncated, left) */}
							<text
								x={4}
								y={y + LANE_HEIGHT / 2 + 3}
								className="fill-muted-foreground"
								style={{ fontSize: 9, fontFamily: 'var(--font-mono, monospace)' }}
							>
								{lane.name.length > 18 ? `${lane.name.slice(0, 17)}…` : lane.name}
							</text>
							{/* session bands */}
							{lane.bands.map((b, bi) => {
								const x1 = xFor(new Date(b.start).getTime());
								const x2 = xFor(new Date(b.end).getTime());
								const w = Math.max(x2 - x1, 2);
								return (
									<rect
										key={`band-${bi}`}
										x={x1}
										y={y + 3}
										width={w}
										height={LANE_HEIGHT - 6}
										rx={2}
										className={isFocused ? BAND_FILL_FOCUS : `${BAND_FILL} opacity-70`}
									>
										<title>
											{`${lane.name}\nonline: ${new Date(b.start).toLocaleString('pt-BR')} → ${new Date(b.end).toLocaleString('pt-BR')}`}
										</title>
									</rect>
								);
							})}
						</g>
					);
				})}
			</svg>
		</div>
	);
}
