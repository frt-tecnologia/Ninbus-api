'use client';

import { Id, Time } from '@/components/system';
import type { ActivityLogEntry } from '@/lib/api/observability';
import { cn } from '@/lib/utils';

/**
 * <ActivityFeed> — the audit log timeline (Section 3 of the company
 * observability page). Each entry shows who acted, what entity, the action,
 * and when — using the design-system primitives (Signal-adjacent, Id, Time).
 * Presentational.
 */

/** Map an action to a short PT-BR label + a tone for the leading marker. */
function actionMeta(action: string): { label: string; tone: string } {
	const created =
		action.endsWith('.created') ||
		action === 'device.provisioned' ||
		action === 'artifact.uploaded' ||
		action === 'designation.claimed';
	const deleted =
		action.endsWith('.deleted') ||
		action === 'device.deprovisioned' ||
		action === 'designation.cancelled' ||
		action === 'member.removed';
	const suspended = action === 'company.suspended';
	const changed =
		action.endsWith('.updated') || action.endsWith('_changed') || action === 'member.role_changed';
	if (created) return { label: 'Criou', tone: 'text-signal-ok' };
	if (deleted) return { label: 'Removeu', tone: 'text-signal-fault' };
	if (suspended) return { label: 'Suspendeu', tone: 'text-signal-busy' };
	if (changed) return { label: 'Alterou', tone: 'text-signal-info' };
	return { label: 'Ação', tone: 'text-muted-foreground' };
}

/** Human-readable entity type in PT-BR. */
function entityLabel(entityType: string): string {
	const map: Record<string, string> = {
		company: 'empresa',
		category: 'grupo',
		device: 'dispositivo',
		deployment: 'deployment',
		artifact: 'artifact',
		member: 'membro',
		designation: 'designação',
		user: 'usuário',
	};
	return map[entityType] ?? entityType;
}

export interface ActivityFeedProps {
	entries: ActivityLogEntry[];
	loading?: boolean;
	className?: string;
}

export function ActivityFeed({ entries, loading, className }: ActivityFeedProps) {
	if (loading) {
		return (
			<div className={cn('space-y-2 p-3', className)}>
				{Array.from({ length: 4 }).map((_, i) => (
					<div key={i} className="h-10 animate-pulse rounded bg-secondary/60" />
				))}
			</div>
		);
	}

	if (entries.length === 0) {
		return (
			<p className="p-6 text-center text-sm text-muted-foreground">
				Nenhuma atividade registrada no período.
			</p>
		);
	}

	return (
		<ol role="list" className={cn('relative space-y-0', className)}>
			{entries.map((e) => {
				const meta = actionMeta(e.action);
				return (
					<li
						key={e.id}
						className="relative flex gap-3 border-b border-border px-4 py-2.5 last:border-0"
					>
						{/* timeline marker */}
						<div className="flex flex-col items-center pt-1">
							<span className={cn('h-2 w-2 rounded-full bg-current', meta.tone)} aria-hidden />
							<span className="mt-1 w-px flex-1 bg-border" aria-hidden />
						</div>
						<div className="min-w-0 flex-1">
							<div className="flex items-baseline justify-between gap-2">
								<p className="truncate text-xs text-foreground">
									<span className="font-medium">{e.actorEmail ?? 'sistema'}</span>
									<span className="text-muted-foreground">
										{' '}
										· {meta.label.toLowerCase()} {entityLabel(e.entityType)}
									</span>
								</p>
								<Time value={e.createdAt} className="shrink-0 text-[10px] text-muted-foreground" />
							</div>
							<div className="mt-0.5 flex items-center gap-2">
								{e.entityLabel && (
									<span className="truncate text-xs text-muted-foreground">{e.entityLabel}</span>
								)}
								<Id value={`#${e.entityId.slice(0, 8)}`} className="text-[10px]" />
							</div>
							{Object.keys(e.metadata).length > 0 && (
								<p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/80">
									{Object.entries(e.metadata)
										.map(([k, v]) => `${k}=${typeof v === 'object' ? '…' : String(v)}`)
										.join(' · ')}
								</p>
							)}
						</div>
					</li>
				);
			})}
		</ol>
	);
}
