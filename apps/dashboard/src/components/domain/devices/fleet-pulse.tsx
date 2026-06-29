'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { Device } from '@/types/domain';
import { connectionSignal } from '@/lib/design/tokens';
import { SignalDot } from '@/components/system';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip';
import { Id, Relative } from '@/components/system';

/**
 * <FleetPulse> — the dashboard's signature overview visual.
 *
 * Each device is a single colored cell in a dense grid, colored by its
 * connection SIGNAL. A glance reveals fleet health (hundreds of devices at
 * once): green = online, neutral = offline, ring = unknown. Hover a cell for
 * the serial + last-seen. This is genuinely useful for OTA operators and looks
 * nothing like a generic stat-card dashboard.
 */
export function FleetPulse({ devices }: { devices: Device[] }) {
	const cells = devices.slice(0, 600); // cap for perf; full virtualization is §future
	return (
		<TooltipProvider delayDuration={150}>
			<div
				className="grid gap-1"
				style={{
					gridTemplateColumns: 'repeat(auto-fill, minmax(0.6rem, 1fr))',
				}}
			>
				{cells.map((d) => {
					const token = connectionSignal(d.connectionStatus);
					return (
						<Tooltip key={d.id}>
							<TooltipTrigger asChild>
								<span
									className="block h-2.5 w-2.5 cursor-default"
									aria-label={token.label}
								>
									<SignalDot token={token} />
								</span>
							</TooltipTrigger>
							<TooltipContent className="max-w-[16rem]">
								<div className="flex flex-col gap-0.5">
									<Id
										value={d.serialDisplay ?? d.serialNumber ?? d.id.slice(0, 8)}
									/>
									<div className="flex items-center gap-1.5 text-[0.7rem] text-muted-foreground">
										<SignalDot token={token} />
										{token.label}
									</div>
									<div className="text-[0.7rem] text-muted-foreground">
										{d.lastSeenAt ? (
											<Relative value={d.lastSeenAt} />
										) : (
											'sem conexão registrada'
										)}
									</div>
								</div>
							</TooltipContent>
						</Tooltip>
					);
				})}
			</div>
		</TooltipProvider>
	);
}

/** Summary legend for the fleet pulse. */
export function FleetLegend() {
	const items: Array<{ k: string; label: string }> = [
		{ k: 'online', label: 'Online' },
		{ k: 'offline', label: 'Offline' },
		{ k: 'unknown', label: 'Desconhecido' },
	];
	return (
		<div className="flex flex-wrap items-center gap-4">
			{items.map((i) => {
				const t = connectionSignal(i.k);
				return (
					<div key={i.k} className="flex items-center gap-1.5 text-xs text-muted-foreground">
						<SignalDot token={t} />
						{i.label}
					</div>
				);
			})}
		</div>
	);
}
