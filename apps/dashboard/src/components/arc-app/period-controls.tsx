'use client';

import * as React from 'react';
import {
	type DateRange,
	DateRangePicker,
} from '@/components/arc/date-range-picker/date-range-picker';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { TimePicker } from '@/components/arc/time-picker/time-picker';
import {
	type Period,
	type PeriodPresetKey,
	saoPauloInstant,
	TZ,
	validateCustom,
} from '@/lib/time/period';
import s from './app.module.css';
import { Alert, Button, Surface } from './primitives';

const PRESETS: PeriodPresetKey[] = ['1h', '24h', '7d', '30d'];

const fmt = (iso: string) =>
	new Date(iso).toLocaleString('pt-BR', {
		timeZone: TZ,
		day: '2-digit',
		month: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	});

export function PeriodPills({
	value,
	onChange,
}: {
	value: Period | null;
	onChange: (period: Period | null) => void;
}) {
	const [dialog, setDialog] = React.useState(false);
	return (
		<section className={s.periodControl} aria-label="Período">
			<SegmentedControl
				label="Período da consulta"
				value={
					value?.kind === 'relative' ? value.preset : value?.kind === 'custom' ? 'custom' : 'all'
				}
				options={[
					{ value: 'all', label: 'Todos' },
					...PRESETS.map((preset) => ({ value: preset, label: preset })),
					{ value: 'custom', label: 'Personalizado' },
				]}
				onValueChange={(preset) => {
					if (preset === 'custom') setDialog(true);
					else
						onChange(
							preset === 'all' ? null : { kind: 'relative', preset: preset as PeriodPresetKey },
						);
				}}
			/>
			{value?.kind === 'custom' && (
				<span className={s.footnote}>
					{fmt(value.from)} → {fmt(value.to)}
				</span>
			)}
			<PeriodDialog
				open={dialog}
				onClose={() => setDialog(false)}
				onApply={(from, to) => onChange({ kind: 'custom', from, to })}
			/>
		</section>
	);
}

function ymd(d: Date) {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function PeriodDialog({
	open,
	onClose,
	onApply,
}: {
	open: boolean;
	onClose: () => void;
	onApply: (from: string, to: string) => void;
}) {
	const [dates, setDates] = React.useState<DateRange | null>(null);
	const [start, setStart] = React.useState('00:00');
	const [end, setEnd] = React.useState('23:59');

	const error = React.useMemo(() => {
		if (!dates) return null;
		const from = saoPauloInstant(ymd(dates.start), start);
		const to = saoPauloInstant(ymd(dates.end), end, true);
		const check = validateCustom(from, to);
		return check.ok ? null : check.reason;
	}, [dates, start, end]);

	const apply = () => {
		if (!dates || error) return;
		onApply(saoPauloInstant(ymd(dates.start), start), saoPauloInstant(ymd(dates.end), end, true));
		onClose();
	};

	return (
		<Surface
			open={open}
			onClose={onClose}
			title="Período personalizado"
			description="Horário de Brasília"
		>
			<div className={s.formStack}>
				<DateRangePicker
					label="Datas"
					placeholder="Escolha as datas"
					value={dates}
					onChange={setDates}
					locale="pt-BR"
					months={1}
					presets={[
						{ label: 'Hoje', range: (t) => ({ start: t, end: t }) },
						{
							label: 'Últimos 7 dias',
							range: (t) => ({
								start: new Date(t.getFullYear(), t.getMonth(), t.getDate() - 6),
								end: t,
							}),
						},
						{
							label: 'Últimos 30 dias',
							range: (t) => ({
								start: new Date(t.getFullYear(), t.getMonth(), t.getDate() - 29),
								end: t,
							}),
						},
					]}
				/>
				<div className={s.twoCols}>
					<TimePicker
						label="Horário inicial"
						value={start}
						onChange={setStart}
						format="24h"
						minuteStep={5}
					/>
					<TimePicker
						label="Horário final"
						value={end}
						onChange={setEnd}
						format="24h"
						minuteStep={5}
					/>
				</div>
				{error && (
					<Alert tone="danger" title="Intervalo inválido">
						{error}
					</Alert>
				)}
				<div className={s.inline}>
					<Button onClick={apply} disabled={!dates || !!error}>
						Aplicar período
					</Button>
					<Button variant="secondary" onClick={onClose}>
						Cancelar
					</Button>
				</div>
			</div>
		</Surface>
	);
}
