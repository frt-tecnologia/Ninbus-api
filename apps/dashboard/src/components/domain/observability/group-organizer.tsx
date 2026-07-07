'use client';

import { Empty } from '@/components/system';
import type { AggregatedCategory } from '@/lib/api/observability';
import { cn } from '@/lib/utils';
import { Settings } from 'lucide-react';
import * as React from 'react';
import { GroupCreateDialog } from './group-create-dialog';
import { GroupManageDialog } from './group-manage-dialog';
import { GROUP_TYPE_LABELS, GroupTypeIcon } from './group-type-icon';

/**
 * <GroupOrganizer> — device groups organized into 3 always-present cards:
 * Linhas de ônibus, Garagens, Regiões (the core fleet organization layers).
 *
 * Each card:
 *  - ALWAYS shows (even when empty → "Nenhum registro" empty state)
 *  - Has a "+" button in its header to create a new group of that type
 *  - Lists the groups of that type with a gear button (opens GroupManageDialog)
 *
 * Layout: 3 cards side-by-side on desktop, stacked on mobile. The cards are
 * taller (flex-col, min-height) so they breathe and hold more items.
 */

/** The 3 always-present group types (core fleet organization). */
const CORE_TYPES = ['bus_line', 'garage', 'region'] as const;

export interface GroupOrganizerProps {
	companyId: string;
	categories: AggregatedCategory[];
	loading?: boolean;
	className?: string;
}

export function GroupOrganizer({ companyId, categories, loading, className }: GroupOrganizerProps) {
	const [editing, setEditing] = React.useState<AggregatedCategory | null>(null);

	// Group categories by type.
	const grouped = React.useMemo(() => {
		const map = new Map<string, AggregatedCategory[]>();
		for (const c of categories) {
			const arr = map.get(c.type) ?? [];
			arr.push(c);
			map.set(c.type, arr);
		}
		return map;
	}, [categories]);

	return (
		<>
			<div className={cn('grid grid-cols-1 gap-4 p-4 md:grid-cols-3', className)}>
				{CORE_TYPES.map((type) => {
					const items = grouped.get(type) ?? [];
					return (
						<GroupCard
							key={type}
							companyId={companyId}
							type={type}
							items={items}
							loading={loading}
							onEdit={setEditing}
						/>
					);
				})}
			</div>

			{/* Custom / yard types (shown only if they exist, below the core 3) */}
			<ExtraTypes
				companyId={companyId}
				grouped={grouped}
				loading={loading}
				onEdit={setEditing}
				className={cn('px-4 pb-4', className)}
			/>

			<GroupManageDialog
				companyId={companyId}
				category={editing}
				open={!!editing}
				onOpenChange={(o) => !o && setEditing(null)}
			/>
		</>
	);
}

/** A single group-type card (always rendered for core types). */
function GroupCard({
	companyId,
	type,
	items,
	loading,
	onEdit,
}: {
	companyId: string;
	type: string;
	items: AggregatedCategory[];
	loading?: boolean;
	onEdit: (c: AggregatedCategory) => void;
}) {
	return (
		<div className="flex min-h-[240px] flex-col rounded-lg border border-border bg-background/50 p-3">
			<header className="mb-2 flex items-center justify-between border-b border-border pb-2">
				<h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
					<GroupTypeIcon type={type} className="h-4 w-4 text-muted-foreground" />
					{GROUP_TYPE_LABELS[type] ?? type}
					<span className="ml-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
						{items.length}
					</span>
				</h3>
				<GroupCreateDialog companyId={companyId} defaultType={type} />
			</header>

			<div className="flex-1 overflow-y-auto">
				{loading ? (
					<div className="space-y-1.5">
						{Array.from({ length: 3 }).map((_, i) => (
							<div key={i} className="h-7 animate-pulse rounded bg-secondary/60" />
						))}
					</div>
				) : items.length === 0 ? (
					<div className="flex h-full items-center justify-center py-6">
						<p className="text-center text-xs text-muted-foreground">
							Nenhum registro.
							<br />
							Clique em + para adicionar.
						</p>
					</div>
				) : (
					<ul className="space-y-0.5">
						{items.map((c) => (
							<li key={c.id}>
								<div className="group flex items-center gap-1 rounded px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground">
									<span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
									<span className="shrink-0 font-mono text-[10px] text-muted-foreground">
										{c.deviceCount}
									</span>
									<button
										type="button"
										aria-label={`Gerenciar grupo ${c.name}`}
										onClick={() => onEdit(c)}
										className="shrink-0 rounded p-0.5 text-muted-foreground/0 transition-colors hover:bg-background hover:text-foreground group-hover:text-muted-foreground"
									>
										<Settings className="h-3 w-3" />
									</button>
								</div>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}

/** Non-core types (yard, custom) shown inline only if they have items. */
function ExtraTypes({
	companyId,
	grouped,
	loading,
	onEdit,
	className,
}: {
	companyId: string;
	grouped: Map<string, AggregatedCategory[]>;
	loading?: boolean;
	onEdit: (c: AggregatedCategory) => void;
	className?: string;
}) {
	const extras = ['yard', 'custom'].filter((t) => (grouped.get(t)?.length ?? 0) > 0);
	if (extras.length === 0) return null;

	return (
		<div className={cn('mt-2 grid grid-cols-1 gap-4 md:grid-cols-2', className)}>
			{extras.map((type) => (
				<GroupCard
					key={type}
					companyId={companyId}
					type={type}
					items={grouped.get(type) ?? []}
					loading={loading}
					onEdit={onEdit}
				/>
			))}
		</div>
	);
}

void Empty; // reserved for future empty-state variation
