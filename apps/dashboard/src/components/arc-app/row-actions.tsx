'use client';
import { type LucideIcon, Pencil } from 'lucide-react';
import { useState } from 'react';
import { InlineEdit } from '@/components/arc/inline-edit/inline-edit';
import type { DataColumn } from '@/components/arc/sortable-data-table/sortable-data-table';
import s from './app.module.css';
import { SafeAction, Surface } from './primitives';

// ── Rename ─────────────────────────────────────────────────────────────

export function RenameInline({
	value,
	label,
	onSave,
	placeholder,
	validate,
	heading,
}: {
	value: string;
	label: string;
	onSave: (next: string) => Promise<unknown>;
	placeholder?: string;
	validate?: (next: string) => string | null | undefined;
	heading?: boolean;
}) {
	return (
		<InlineEdit
			value={value}
			label={label}
			onSave={onSave}
			placeholder={placeholder}
			validate={validate}
			variant={heading ? 'title' : 'body'}
		/>
	);
}

// ── Actions column ─────────────────────────────────────────────────────

export interface RowAction<Row> {
	key: string;
	label: string;
	icon: LucideIcon;
	onAction: (row: Row) => void | Promise<void>;
	/** Destructive actions open a confirmation overlay. */
	hold?: boolean;
	holdLabel?: string;
	confirmedLabel?: string;
	disabled?: (row: Row) => boolean;
	'aria-label'?: (row: Row) => string;
}

/**
 * Builds the trailing actions column. Append to the screen's `columns`.
 * Kept as a factory so the column shape stays a presentation detail —
 * screens only declare *what* each row can do.
 */
export function rowActionsColumn<Row extends Record<string, unknown>>(
	actions: RowAction<Row>[],
): DataColumn<Row> {
	return {
		key: '__actions',
		label: 'Ações',
		sortable: false,
		width: 96,
		render: (_: unknown, row: Row) => (
			// biome-ignore lint/a11y/noStaticElementInteractions: decorative stopPropagation wrapper — children are real buttons
			// biome-ignore lint/a11y/useKeyWithClickEvents: no keyboard behavior is needed; children handle their own keys
			<div className={s.rowActions} onClick={(e) => e.stopPropagation()}>
				{actions.map((action) => {
					if (action.hold) {
						return <RowConfirmation key={action.key} action={action} row={row} />;
					}
					const Icon = action.icon;
					const disabled = action.disabled?.(row) ?? false;
					return (
						<button
							key={action.key}
							type="button"
							className={s.rowActionButton}
							disabled={disabled}
							onClick={() => void action.onAction(row)}
							aria-label={action['aria-label']?.(row) ?? action.label}
							title={action.label}
						>
							<Icon size={15} aria-hidden />
						</button>
					);
				})}
			</div>
		),
	};
}

/** Convenience icon for "rename" quick actions (opens the Surface editor). */
export const RenameIcon = Pencil;

function RowConfirmation<Row>({ action, row }: { action: RowAction<Row>; row: Row }) {
	const [open, setOpen] = useState(false);
	const Icon = action.icon;
	const record = row as Record<string, unknown>;
	const name = String(record.name ?? record.email ?? record.id ?? '');
	return (
		<>
			<button
				type="button"
				className={s.rowActionButton}
				disabled={action.disabled?.(row)}
				onClick={() => setOpen(true)}
				aria-label={action.label}
				title={action.label}
			>
				<Icon size={15} aria-hidden />
			</button>
			<Surface open={open} onClose={() => setOpen(false)} title={action.label}>
				<p className={s.confirmRecord}>{name}</p>
				<SafeAction
					label={action.label.toLocaleLowerCase('pt-BR')}
					description=""
					danger
					onConfirm={async () => {
						await action.onAction(row);
						setOpen(false);
					}}
				/>
			</Surface>
		</>
	);
}
