'use client';

import { type ReactNode, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/State';

export interface Column<T> {
	/** Unique key for React + sorting. */
	key: string;
	/** Column header label. */
	header: string;
	/** Cell renderer. */
	render: (row: T) => ReactNode;
	/** Optional value accessor for client-side sorting/searching. */
	sortValue?: (row: T) => string | number;
	/** Whether this column is sortable. */
	sortable?: boolean;
}

export interface DataTableProps<T> {
	columns: Column<T>[];
	rows: T[];
	rowKey: (row: T) => string;
	loading?: boolean;
	emptyState?: ReactNode;
	onRowClick?: (row: T) => void;
}

type SortDir = 'asc' | 'desc';

/**
 * Generic, reusable client-side DataTable.
 *
 * Supports sorting (clicking a sortable header) and renders loading/empty states.
 * Filtering/searching is handled by the parent (SearchToolbar) so each table can
 * define its own filter logic; this component only cares about presentation.
 */
export function DataTable<T>({
	columns,
	rows,
	rowKey,
	loading,
	emptyState,
	onRowClick,
}: DataTableProps<T>) {
	const [sortKey, setSortKey] = useState<string | null>(null);
	const [sortDir, setSortDir] = useState<SortDir>('asc');

	const sorted = useMemo(() => {
		if (!sortKey) return rows;
		const col = columns.find((c) => c.key === sortKey);
		if (!col?.sortValue) return rows;
		const dir = sortDir === 'asc' ? 1 : -1;
		return [...rows].sort((a, b) => {
			const va = col.sortValue!(a);
			const vb = col.sortValue!(b);
			if (va < vb) return -1 * dir;
			if (va > vb) return 1 * dir;
			return 0;
		});
	}, [rows, columns, sortKey, sortDir]);

	function toggleSort(key: string) {
		const col = columns.find((c) => c.key === key);
		if (!col?.sortable) return;
		if (sortKey === key) {
			setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
		} else {
			setSortKey(key);
			setSortDir('asc');
		}
	}

	if (loading) {
		return <Spinner />;
	}

	if (rows.length === 0 && emptyState) {
		return <>{emptyState}</>;
	}

	return (
		<div className="overflow-x-auto">
			<table className="min-w-full divide-y divide-gray-200">
				<thead className="bg-gray-50">
					<tr>
						{columns.map((col) => (
							<th
								key={col.key}
								scope="col"
								className={cn(
									'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500',
									col.sortable && 'cursor-pointer select-none hover:bg-gray-100',
								)}
								onClick={() => toggleSort(col.key)}
							>
								<span className="inline-flex items-center gap-1">
									{col.header}
									{col.sortable && sortKey === col.key && (
										<span aria-hidden>{sortDir === 'asc' ? '▲' : '▼'}</span>
									)}
								</span>
							</th>
						))}
					</tr>
				</thead>
				<tbody className="divide-y divide-gray-100 bg-white">
					{sorted.map((row) => (
						<tr
							key={rowKey(row)}
							className={cn(
								'transition-colors hover:bg-gray-50',
								onRowClick && 'cursor-pointer',
							)}
							onClick={onRowClick ? () => onRowClick(row) : undefined}
						>
							{columns.map((col) => (
								<td
									key={col.key}
									className="whitespace-nowrap px-4 py-3 text-sm text-gray-700"
								>
									{col.render(row)}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
