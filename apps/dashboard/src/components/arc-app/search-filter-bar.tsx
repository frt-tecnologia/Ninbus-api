'use client';

import { CalendarClock } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import {
	type FilterChip,
	type FilterField,
	FilterToolbar,
} from '@/components/arc/filter-toolbar/filter-toolbar';
import { SearchField } from '@/components/arc/search-field/search-field';
import { type Period, type PeriodPresetKey, PRESET_LABELS, periodLabel } from '@/lib/time/period';
import s from './app.module.css';
import { PeriodDialog } from './period-controls';

const PERIOD_FIELD_ID = '__period';

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
	const [custom, setCustom] = useState(false);

	const available: FilterField[] = temporal
		? [
				...fields,
				{
					id: PERIOD_FIELD_ID,
					label: 'Data e hora',
					icon: <CalendarClock size={16} />,
					options: [
						...Object.entries(PRESET_LABELS).map(([value, presetLabel]) => ({
							value,
							label: presetLabel,
						})),
						{ value: 'custom', label: 'Personalizado' },
					],
				},
			]
		: fields;

	const applied: FilterChip[] =
		temporal && period
			? [
					...filters,
					{
						id: PERIOD_FIELD_ID,
						label: 'Período',
						value: period.kind === 'relative' ? period.preset : 'custom',
						displayValue: periodLabel(period),
					},
				]
			: filters;

	function removeFilter(id: string) {
		if (id === PERIOD_FIELD_ID) onPeriodChange(null);
		else onFiltersChange(filters.filter((filter) => filter.id !== id));
	}

	return (
		<div className={s.searchFilterBar}>
			<SearchField
				label={`Pesquisar ${label.toLowerCase()}`}
				value={query}
				onValueChange={onQueryChange}
				placeholder={`Pesquisar ${label.toLowerCase()}`}
			/>
			{extra}
			{(available.length > 0 || applied.length > 0) && (
				<FilterToolbar
					variant="bare"
					label="Filtros aplicados"
					filters={applied}
					onRemove={removeFilter}
					onClearAll={() => {
						onFiltersChange([]);
						if (temporal) onPeriodChange(null);
					}}
					addFilter={
						available.length
							? {
									fields: available,
									label: 'Filtrar',
									onAdd: (filter) => {
										if (filter.id === PERIOD_FIELD_ID) {
											if (filter.value === 'custom') setCustom(true);
											else
												onPeriodChange({
													kind: 'relative',
													preset: filter.value as PeriodPresetKey,
												});
										} else {
											onFiltersChange([...filters.filter((item) => item.id !== filter.id), filter]);
										}
									},
								}
							: undefined
					}
				/>
			)}
			{temporal && (
				<PeriodDialog
					open={custom}
					onClose={() => setCustom(false)}
					onApply={(from, to) => onPeriodChange({ kind: 'custom', from, to })}
				/>
			)}
		</div>
	);
}
