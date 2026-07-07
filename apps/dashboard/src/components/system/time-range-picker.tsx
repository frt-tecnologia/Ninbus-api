'use client';

import * as React from 'react';
import { Calendar, ChevronDown, Check, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
	type TimeRange,
	useRange,
	PRESETS,
	CUSTOM_LABEL,
	toLocalInput,
} from './time-range-context';

/**
 * <TimeRangePicker> — the reusable time-window selector.
 *
 * Renders as a Radix <Popover> (Portal), so the dropdown NEVER clashes with
 * other overlays — it lives in the document top layer, not the component's DOM
 * parent. This fixes the old z-index bug where the picker sat ON TOP of the
 * universal-search dialog. Organic enter/exit come from Popover data-state.
 *
 * Variants:
 *  - <TimeRangePicker /> reads/writes the shared <RangeProvider> range.
 *  - <TimeRangePickerStandalone range onApply /> for pages without a provider.
 */
export function TimeRangePicker({ className }: { className?: string }) {
	const { range, setRange } = useRange();
	return <Picker range={range} onApply={setRange} className={className} />;
}

export function TimeRangePickerStandalone({
	range,
	onApply,
	className,
}: {
	range: TimeRange;
	onApply: (r: TimeRange) => void;
	className?: string;
}) {
	return <Picker range={range} onApply={onApply} className={className} />;
}

function Picker({
	range,
	onApply,
	className,
}: {
	range: TimeRange;
	onApply: (r: TimeRange) => void;
	className?: string;
}) {
	const [open, setOpen] = React.useState(false);
	const [showCustom, setShowCustom] = React.useState(false);
	const [fromVal, setFromVal] = React.useState('');
	const [toVal, setToVal] = React.useState('');

	React.useEffect(() => {
		if (open) {
			setFromVal(toLocalInput(range.from));
			setToVal(toLocalInput(range.to));
			setShowCustom(range.label === CUSTOM_LABEL);
		}
	}, [open, range]);

	function applyCustom() {
		const from = new Date(fromVal);
		const to = new Date(toVal);
		if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) return;
		onApply({ from, to, label: CUSTOM_LABEL });
		setShowCustom(false);
		setOpen(false);
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					className={cn('h-8 gap-2 px-3 text-xs font-medium', className)}
					aria-haspopup="dialog"
				>
					<Clock className="h-3.5 w-3.5 text-primary" />
					<span className="max-w-[10rem] truncate">{range.label}</span>
					<ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-72 p-0" onCloseAutoFocus={(e) => e.preventDefault()}>
				<div className="p-1.5">
					<p className="px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
						Janela de tempo
					</p>
					{PRESETS.map((p) => {
						const active = range.label === p.label;
						return (
							<button
								key={p.label}
								type="button"
								onClick={() => {
									onApply(p.build());
									setShowCustom(false);
									setOpen(false);
								}}
								className={cn(
									'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors',
									active ? 'bg-primary/10 font-medium text-foreground' : 'text-muted-foreground hover:bg-secondary',
								)}
							>
								<span className="flex items-center gap-2">
									<span
										className={cn(
											'flex h-5 w-9 items-center justify-center rounded text-[0.6rem] font-mono',
											active ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground',
										)}
									>
										{p.short}
									</span>
									{p.label}
								</span>
								{active && <Check className="h-3.5 w-3.5 text-primary" />}
							</button>
						);
					})}
				</div>
				<div className="border-t border-border p-1.5">
					<button
						type="button"
						onClick={() => setShowCustom((s) => !s)}
						className={cn(
							'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors',
							range.label === CUSTOM_LABEL ? 'bg-primary/10 font-medium text-foreground' : 'text-muted-foreground hover:bg-secondary',
						)}
					>
						<span className="flex items-center gap-2">
							<Calendar className="h-3.5 w-3.5" />
							{CUSTOM_LABEL}
						</span>
						{(range.label === CUSTOM_LABEL || showCustom) && <Check className="h-3.5 w-3.5 text-primary" />}
					</button>
					{showCustom && (
						<div className="mt-1.5 space-y-2 rounded-md bg-secondary/40 p-2">
							<label className="block">
								<span className="text-[0.6rem] uppercase tracking-wide text-muted-foreground">De</span>
								<input
									type="datetime-local"
									value={fromVal}
									onChange={(e) => setFromVal(e.target.value)}
									className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
								/>
							</label>
							<label className="block">
								<span className="text-[0.6rem] uppercase tracking-wide text-muted-foreground">Até</span>
								<input
									type="datetime-local"
									value={toVal}
									onChange={(e) => setToVal(e.target.value)}
									className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
								/>
							</label>
							<Button type="button" size="sm" className="h-7 w-full text-xs" onClick={applyCustom} disabled={!fromVal || !toVal}>
								Aplicar
							</Button>
						</div>
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}
