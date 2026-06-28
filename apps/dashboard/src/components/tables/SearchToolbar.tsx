'use client';

import { type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';

export interface ToolbarAction {
	label: string;
	onClick: () => void;
	variant?: 'primary' | 'secondary' | 'outline';
	icon?: ReactNode;
}

/**
 * SearchToolbar — search input + optional filter dropdowns + actions (export, create).
 * Used above every data table for consistent UX.
 */
export function SearchToolbar({
	search,
	onSearchChange,
	searchPlaceholder = 'Buscar...',
	children,
	actions,
}: {
	search: string;
	onSearchChange: (v: string) => void;
	searchPlaceholder?: string;
	/** Extra filter controls (selects, date pickers). */
	children?: ReactNode;
	actions?: ToolbarAction[];
}) {
	return (
		<div className="mb-4 flex flex-wrap items-center gap-3">
			<input
				type="search"
				value={search}
				onChange={(e) => onSearchChange(e.target.value)}
				placeholder={searchPlaceholder}
				className="block h-10 min-w-[200px] flex-1 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
			/>
			{children}
			{actions && (
				<div className="ml-auto flex items-center gap-2">
					{actions.map((a) => (
						<Button
							key={a.label}
							variant={a.variant ?? 'outline'}
							size="sm"
							onClick={a.onClick}
						>
							{a.icon}
							{a.label}
						</Button>
					))}
				</div>
			)}
		</div>
	);
}
