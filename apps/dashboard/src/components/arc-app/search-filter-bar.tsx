'use client';

import type { ReactNode } from 'react';
import {
	type FilterChip,
	type FilterField,
	FilterToolbar,
} from '@/components/arc/filter-toolbar/filter-toolbar';
import { SearchField } from '@/components/arc/search-field/search-field';
import type { Period } from '@/lib/time/period';
import s from './app.module.css';
import { PeriodFilter } from './period-controls';

export function SearchFilterBar({
	label,
	query,
	onQueryChange,
	fields,
	filters,
	onFiltersChange,
	temporal,
	period,
	onPeriodChange,
	extra,
}: {
	label: string;
	query: string;
	onQueryChange: (value: string) => void;
	fields: FilterField[];
	filters: FilterChip[];
	onFiltersChange: (filters: FilterChip[]) => void;
	temporal: boolean;
	period: Period | null;
	onPeriodChange: (period: Period | null) => void;
	extra?: ReactNode;
}) {
	return (
		<div className={s.searchFilterBar}>
			<SearchField
				label={`Pesquisar ${label.toLowerCase()}`}
				value={query}
				onValueChange={onQueryChange}
				placeholder={`Pesquisar ${label.toLowerCase()}`}
			/>
			{temporal && (
				<PeriodFilter
					period={period}
					onChange={(next) => {
						onPeriodChange(next);
					}}
				/>
			)}
			{(fields.length > 0 || filters.length > 0) && (
				<FilterToolbar
					label="Filtros aplicados"
					filters={filters}
					onRemove={(id) => onFiltersChange(filters.filter((filter) => filter.id !== id))}
					onClearAll={() => onFiltersChange([])}
					addFilter={
						fields.length
							? {
									fields,
									label: 'Filtrar',
									onAdd: (filter) =>
										onFiltersChange([...filters.filter((item) => item.id !== filter.id), filter]),
								}
							: undefined
					}
				/>
			)}
			{extra}
		</div>
	);
}
