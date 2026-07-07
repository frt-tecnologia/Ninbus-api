'use client';

import { Empty, ErrorState, SearchField, TableLoading } from '@/components/system';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import * as React from 'react';

/**
 * Lightweight, reusable data table.
 *
 * Column-driven, with client-side sort + an optional search field, built on the
 * shadcn <Table> primitives. Deliberately NOT a full TanStack abstraction —
 * it covers the dashboard's needs (list + sort + search + empty/error/loading)
 * in one containerizable, <250-line component. Each column is presentational
 * (`render`) so domain tables stay declarative.
 *
 * `actions(row)` renders a trailing per-row action cell (e.g. a menu).
 */
export type Column<T> = {
	key: string;
	header: React.ReactNode;
	sortValue?: (row: T) => string | number;
	render?: (row: T) => React.ReactNode;
	className?: string;
	headerClassName?: string;
};

type DataTableProps<T> = {
	columns: Column<T>[];
	rows: T[];
	rowKey: (row: T) => string;
	loading?: boolean;
	error?: string | null;
	onRetry?: () => void;
	/** When set, shows a search box that filters via this predicate. */
	search?: {
		value: string;
		onChange: (v: string) => void;
		placeholder?: string;
		/** Predicate over a row; defaults to matching all column string values. */
		filter?: (row: T, term: string) => boolean;
		/** When true, the search INPUT is NOT rendered here (the parent renders its
		 *  own input via e.g. a Section action slot) but filtering still applies. */
		hideInput?: boolean;
	};
	empty?: React.ReactNode;
	actions?: (row: T) => React.ReactNode;
};

export function DataTable<T>({
	columns,
	rows,
	rowKey,
	loading,
	error,
	onRetry,
	search,
	empty,
	actions,
}: DataTableProps<T>) {
	const [sortKey, setSortKey] = React.useState<string | null>(null);
	const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc');

	const filtered = React.useMemo(() => {
		if (!search?.value) return rows;
		const term = search.value.trim().toLowerCase();
		if (!term) return rows;
		// Custom predicate, or default: match any column's rendered/sort text.
		if (search.filter) return rows.filter((r) => search.filter!(r, term));
		return rows.filter((r) => {
			return columns.some((c) => {
				if (c.sortValue) {
					const v = c.sortValue(r);
					return String(v ?? '')
						.toLowerCase()
						.includes(term);
				}
				return false;
			});
		});
	}, [rows, search?.value, search?.filter, columns]);

	const sorted = React.useMemo(() => {
		if (!sortKey) return filtered;
		const col = columns.find((c) => c.key === sortKey);
		if (!col?.sortValue) return filtered;
		const copy = [...filtered];
		copy.sort((a, b) => {
			const av = col.sortValue!(a);
			const bv = col.sortValue!(b);
			if (av < bv) return sortDir === 'asc' ? -1 : 1;
			if (av > bv) return sortDir === 'asc' ? 1 : -1;
			return 0;
		});
		return copy;
	}, [filtered, sortKey, sortDir, columns]);

	const toggleSort = (key: string) => {
		if (sortKey !== key) {
			setSortKey(key);
			setSortDir('asc');
		} else if (sortDir === 'asc') {
			setSortDir('desc');
		} else {
			setSortKey(null);
		}
	};

	return (
		<div className="flex flex-col gap-3">
			{search && !search.hideInput && (
				<SearchField
					value={search.value}
					onChange={search.onChange}
					placeholder={search.placeholder ?? 'Buscar…'}
					className="w-full sm:max-w-md"
				/>
			)}
			{error ? (
				<ErrorState message={error} onRetry={onRetry} />
			) : loading ? (
				<TableLoading />
			) : sorted.length === 0 ? (
				(empty ?? <Empty />)
			) : (
				<div className="overflow-hidden rounded-lg border border-border">
					<Table>
						<TableHeader>
							<TableRow className="hover:bg-transparent">
								{columns.map((col) => {
									const active = sortKey === col.key;
									return (
										<TableHead key={col.key} className={col.headerClassName}>
											{col.sortValue ? (
												<button
													type="button"
													onClick={() => toggleSort(col.key)}
													className={cn(
														'inline-flex items-center gap-1 transition-colors hover:text-foreground',
														active && 'text-foreground',
													)}
												>
													{col.header}
													{active ? (
														sortDir === 'asc' ? (
															<ChevronUp className="h-3 w-3" />
														) : (
															<ChevronDown className="h-3 w-3" />
														)
													) : (
														<ChevronsUpDown className="h-3 w-3 opacity-40" />
													)}
												</button>
											) : (
												col.header
											)}
										</TableHead>
									);
								})}
								{actions && <TableHead className="w-10" />}
							</TableRow>
						</TableHeader>
						<TableBody>
							{sorted.map((row) => (
								<TableRow key={rowKey(row)}>
									{columns.map((col) => (
										<TableCell key={col.key} className={col.className}>
											{col.render ? col.render(row) : null}
										</TableCell>
									))}
									{actions && <TableCell className="text-right">{actions(row)}</TableCell>}
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}
		</div>
	);
}
