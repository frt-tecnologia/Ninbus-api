'use client';

import { SignalDot } from '@/components/system';
import { connectionSignal } from '@/lib/design/tokens';
import { cn } from '@/lib/utils';

/**
 * <DeviceConnectionList> — the side panel of the connectivity section.
 *
 * Lists the company's devices ordered by "last seen" (most recent first), each
 * with its connection signal. Clicking a row focuses that device's lane in the
 * <ConnectionTimeline>. Fully presentational.
 */
export interface DeviceConnectionListItem {
	id: string;
	name: string;
	hawkbitTargetId: string | null;
	serialDisplay: string | null;
	connectionStatus: string | null;
	lastSeenAt: string | null;
}

export interface DeviceConnectionListProps {
	devices: DeviceConnectionListItem[];
	focusedDeviceId?: string | null;
	onFocus?: (deviceId: string | null) => void;
	loading?: boolean;
	className?: string;
}

export function DeviceConnectionList({
	devices,
	focusedDeviceId,
	onFocus,
	loading,
	className,
}: DeviceConnectionListProps) {
	if (loading) {
		return (
			<div className={cn('space-y-1.5 p-2', className)}>
				{Array.from({ length: 5 }).map((_, i) => (
					<div key={i} className="h-8 animate-pulse rounded bg-secondary/60" />
				))}
			</div>
		);
	}

	if (devices.length === 0) {
		return (
			<p className="p-4 text-center text-xs text-muted-foreground">
				Nenhum dispositivo nesta empresa.
			</p>
		);
	}

	// Sort by lastSeenAt descending (most recent first); nulls last.
	const sorted = [...devices].sort((a, b) => {
		const ta = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
		const tb = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
		return tb - ta;
	});

	return (
		<ul
			role="list"
			className={cn('max-h-[360px] divide-y divide-border overflow-y-auto', className)}
		>
			{sorted.map((d) => {
				const token = connectionSignal(d.connectionStatus ?? 'unknown');
				const active = focusedDeviceId === d.id;
				return (
					<li key={d.id}>
						<button
							type="button"
							onClick={() => onFocus?.(active ? null : d.id)}
							aria-pressed={active}
							className={cn(
								'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-secondary/60',
								active && 'bg-secondary',
							)}
						>
							<SignalDot token={token} />
							<div className="min-w-0 flex-1">
								<div className="truncate text-xs font-medium text-foreground">{d.name}</div>
								<div className="truncate font-mono text-[10px] text-muted-foreground">
									{d.serialDisplay ?? d.hawkbitTargetId ?? '—'}
								</div>
							</div>
							<div className="shrink-0 text-right text-[10px] text-muted-foreground">
								{d.lastSeenAt
									? new Date(d.lastSeenAt).toLocaleTimeString('pt-BR', {
											hour: '2-digit',
											minute: '2-digit',
										})
									: '—'}
							</div>
						</button>
					</li>
				);
			})}
		</ul>
	);
}
