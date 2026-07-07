'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { SignalTone } from '@/lib/design/tokens';
import { TONE_FILL } from '@/components/system/charts/shared';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';

/**
 * <DottedMap> — forward-looking deployment geo-telemetry canvas.
 *
 * Renders a dotted world grid (equirectangular projection) as the backdrop
 * and overlays colored "pins" for deployments, classified by outcome tone
 * (ok=success, fault=error, busy=in_progress, idle=pending). A status filter
 * lets the operator isolate outcomes. Each pin is hoverable for details.
 *
 * Today the pins are driven by the `pins` prop (empty by default). When the
 * backend exposes deployment geo-coordinates, feed them in and the map lights
 * up — the projection + filter + tooltip plumbing is already here. This is
 * deliberately dependency-free (no `dotted-map` npm pkg) so it stays
 * bundle-lean and never breaks on a registry hiccup.
 */

export interface MapPin {
	id: string;
	lat: number;
	lng: number;
	tone: SignalTone;
	label: string;
	detail?: string;
}

const VIEW_W = 720;
const VIEW_H = 360;

/** Equirectangular projection: lng/lat → SVG x/y. */
function project(lat: number, lng: number): { x: number; y: number } {
	return {
		x: ((lng + 180) / 360) * VIEW_W,
		y: ((90 - lat) / 180) * VIEW_H,
	};
}

/** The dotted backdrop: a sparse grid of dots, masked into a soft globe shape. */
function DottedBackdrop({ step = 9 }: { step?: number }) {
	const dots: { x: number; y: number }[] = [];
	for (let y = step / 2; y < VIEW_H; y += step) {
		for (let x = step / 2; x < VIEW_W; x += step) {
			dots.push({ x, y });
		}
	}
	return (
		<g>
			<defs>
				<radialGradient id="dotted-map-vignette" cx="50%" cy="50%" r="62%">
					<stop offset="55%" stopColor="white" stopOpacity="1" />
					<stop offset="100%" stopColor="white" stopOpacity="0.12" />
				</radialGradient>
				<mask id="dotted-map-mask">
					<rect width={VIEW_W} height={VIEW_H} fill="url(#dotted-map-vignette)" />
				</mask>
			</defs>
			<g mask="url(#dotted-map-mask)">
				{dots.map((d, i) => (
					<circle
						key={i}
						cx={d.x}
						cy={d.y}
						r={1}
						fill="hsl(var(--muted-foreground) / 0.32)"
					/>
				))}
			</g>
		</g>
	);
}

export type MapFilter = 'all' | SignalTone;

const FILTER_OPTIONS: { value: MapFilter; label: string }[] = [
	{ value: 'all', label: 'Todos os status' },
	{ value: 'ok', label: 'Sucesso' },
	{ value: 'fault', label: 'Falha' },
	{ value: 'busy', label: 'Em andamento' },
	{ value: 'idle', label: 'Pendente' },
];

export function DottedMap({
	pins = [],
	className,
}: {
	pins?: MapPin[];
	className?: string;
}) {
	const [filter, setFilter] = React.useState<MapFilter>('all');
	const shown = pins.filter((p) => filter === 'all' || p.tone === filter);

	return (
		<div className={cn('flex flex-col gap-3', className)}>
			<div className="flex items-center justify-between gap-2">
				<p className="text-xs text-muted-foreground">
					{pins.length === 0
						? 'Aguardando telemetria de localização dos deployments.'
						: `${shown.length} de ${pins.length} deployments no mapa.`}
				</p>
				<Select value={filter} onValueChange={(v) => setFilter(v as MapFilter)}>
					<SelectTrigger className="h-8 w-[10rem]">
						<SelectValue placeholder="Status" />
					</SelectTrigger>
					<SelectContent>
						{FILTER_OPTIONS.map((o) => (
							<SelectItem key={o.value} value={o.value}>
								{o.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className="relative overflow-hidden rounded-md border border-border/60 bg-background/40">
				<svg
					viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
					className="h-auto w-full"
					preserveAspectRatio="xMidYMid meet"
					role="img"
					aria-label="Mapa pontilhado de deployments"
				>
					<DottedBackdrop />
					<TooltipProvider delayDuration={120}>
						{shown.map((p) => {
							const { x, y } = project(p.lat, p.lng);
							return (
								<Tooltip key={p.id}>
									<TooltipTrigger asChild>
										<circle
											cx={x}
											cy={y}
											r={4.5}
											fill={TONE_FILL[p.tone]}
											stroke="hsl(var(--background))"
											strokeWidth={1.5}
											className="cursor-pointer transition-transform"
											style={{ transformOrigin: `${x}px ${y}px` }}
										/>
									</TooltipTrigger>
									<TooltipContent className="max-w-[16rem]">
										<div className="flex flex-col gap-0.5">
											<span className="text-xs font-semibold">{p.label}</span>
											{p.detail && (
												<span className="text-[0.7rem] text-muted-foreground">
													{p.detail}
												</span>
											)}
											<span className="font-mono text-[0.65rem] text-muted-foreground">
												{p.lat.toFixed(2)}, {p.lng.toFixed(2)}
											</span>
										</div>
									</TooltipContent>
								</Tooltip>
							);
						})}
					</TooltipProvider>
				</svg>
			</div>
		</div>
	);
}
