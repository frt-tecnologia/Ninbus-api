'use client';

/** Shared search, filters, temporal scope, sorting and pagination. */

import * as React from 'react';
import { Button } from '@/components/arc/button/button';
import { EmptyState } from '@/components/arc/empty-state/empty-state';
import type { FilterChip, FilterField } from '@/components/arc/filter-toolbar/filter-toolbar';
import { Pagination } from '@/components/arc/pagination/pagination';
import {
	type DataColumn,
	SortableDataTable,
} from '@/components/arc/sortable-data-table/sortable-data-table';
import { useQuery } from '@/lib/cache/use-query';
import type { Period } from '@/lib/time/period';
import { resolvePeriod, TZ } from '@/lib/time/period';
import s from './app.module.css';
import type { AnyRow } from './primitives';
import { inPeriod, matches } from './primitives';
import { SearchFilterBar } from './search-filter-bar';

// ── Source contract (Fase-2-ready) ─────────────────────────────────────

export interface PageQuery {
	page: number;
	limit: number;
	search?: string;
	sort?: { key: string; direction: 'asc' | 'desc' };
}

export interface PagedResult<Row> {
	data: Row[];
	total: number;
}

export interface ListSource<Row> {
	key: string;
	load: () => Promise<Row[]>;
	loadPaged?: (query: PageQuery) => Promise<PagedResult<Row>>;
	mode?: 'client' | 'server';
	pageSize?: number;
}

export interface CollectionProps<Row extends AnyRow> {
	rows?: Row[];
	source?: ListSource<Row>;
	columns: DataColumn<Row>[];
	label: string;
	fields?: FilterField[];
	/** Campo temporal usado pelo filtro de período (ex.: createdAt). */
	dateKey?: string;
	/** Texto breve sobre o que o campo temporal significa (ex.: "aplica-se à última comunicação"). */
	dateMeaning?: string;
	showPeriodFilter?: boolean;
	/** Período controlado — quando fornecido, o pai renderiza o seletor. */
	period?: Period | null;
	onPeriodChange?: (p: Period | null) => void;
	defaultSortKey?: string;
	defaultSortDir?: 'asc' | 'desc';
	selectable?: boolean;
	selected?: string[];
	onSelectionChange?: (keys: string[]) => void;
	extra?: React.ReactNode;
	initialFilters?: FilterChip[];
	onOpenRow?: (row: Row) => void;
	initialPageSize?: number;
}

type SortState = { key: string; direction: 'asc' | 'desc' };

export function Collection<Row extends AnyRow>({
	rows,
	source,
	columns,
	label,
	fields = [],
	dateKey,
	dateMeaning,
	showPeriodFilter = true,
	period: controlledPeriod,
	onPeriodChange,
	selectable = false,
	selected,
	onSelectionChange,
	extra,
	initialFilters = [],
	onOpenRow,
	initialPageSize = 10,
	defaultSortKey,
	defaultSortDir = 'desc',
}: CollectionProps<Row>) {
	const serverMode = source?.mode === 'server' && !!source.loadPaged;

	const cached = useQuery<Row[]>(
		source?.key ?? '__static__',
		React.useCallback(() => (source ? source.load() : Promise.resolve(rows ?? [])), [source, rows]),
		{ sync: !!source, deps: [rows, source?.key] },
	);
	const allRows = rows ?? cached.data ?? [];

	const [q, setQ] = React.useState('');
	const [filters, setFilters] = React.useState<FilterChip[]>(initialFilters);
	const [page, setPage] = React.useState(1);
	const [sort, setSort] = React.useState<SortState>(
		defaultSortKey
			? { key: defaultSortKey, direction: defaultSortDir }
			: { key: 'name', direction: 'asc' },
	);

	// ── Período: controlado ou interno ────────────────────────────────
	const isPeriodControlled = controlledPeriod !== undefined;
	const [periodLocal, setPeriodLocal] = React.useState<Period | null>(null);
	const period = isPeriodControlled ? controlledPeriod : periodLocal;
	const handlePeriodChange = React.useCallback(
		(p: Period | null) => {
			if (!isPeriodControlled) setPeriodLocal(p);
			onPeriodChange?.(p);
			setPage(1);
		},
		[isPeriodControlled, onPeriodChange],
	);

	// ── Paging no servidor (Fase 2) ──────────────────────────────────
	const [paged, setPaged] = React.useReducer(
		(_prev: PagedResult<Row> | null, next: PagedResult<Row>) => next,
		null,
	);
	React.useEffect(() => {
		if (!serverMode || !source?.loadPaged) return;
		let active = true;
		source
			.loadPaged({ page, limit: source.pageSize ?? initialPageSize, search: q || undefined, sort })
			.then((result) => active && setPaged(result));
		return () => {
			active = false;
		};
	}, [serverMode, source, page, q, sort, initialPageSize]);

	const filtered = serverMode
		? (paged?.data ?? [])
		: allRows
				.filter(
					(r) =>
						matches(
							q,
							...Object.values(r).flatMap((v) =>
								Array.isArray(v) ? v : typeof v === 'object' ? [] : [v],
							),
						) &&
						filters.every((f) =>
							Array.isArray(r[f.id])
								? (r[f.id] as unknown[]).includes(f.value)
								: f.id === 'companyCount' && f.value === '3+'
									? Number(r[f.id]) >= 3
									: String(r[f.id] ?? '') === f.value,
						) &&
						(!dateKey || inPeriod(r[dateKey], period)),
				)
				.sort((a, b) => {
					const dir = sort.direction === 'asc' ? 1 : -1;
					const av = a[sort.key];
					const bv = b[sort.key];
					if (typeof av === 'number' || typeof bv === 'number') {
						const an = typeof av === 'number' ? av : Number.POSITIVE_INFINITY * dir;
						const bn = typeof bv === 'number' ? bv : Number.POSITIVE_INFINITY * dir;
						if (an !== bn) return (an - bn) * dir;
					} else {
						const as = String(av ?? '');
						const bs = String(bv ?? '');
						const at = as && !Number.isNaN(Date.parse(as)) ? Date.parse(as) : null;
						const bt = bs && !Number.isNaN(Date.parse(bs)) ? Date.parse(bs) : null;
						if (at !== null || bt !== null) {
							if (at === null) return 1;
							if (bt === null) return -1;
							if (at !== bt) return (at - bt) * dir;
						} else {
							const cmp = as.localeCompare(bs, 'pt-BR', { numeric: true });
							if (cmp) return cmp * dir;
						}
					}
					return String(a.id).localeCompare(String(b.id), 'pt-BR', { numeric: true }) * dir;
				});

	const total = serverMode ? (paged?.total ?? 0) : filtered.length;
	const pageSize = source?.pageSize ?? initialPageSize;
	const pages = Math.max(1, Math.ceil(total / pageSize));
	const current = Math.min(page, pages);
	const pageRows = serverMode
		? filtered
		: filtered.slice((current - 1) * pageSize, current * pageSize);

	const rowByIndex = React.useCallback((index: number) => pageRows[index], [pageRows]);

	const onTableClick = (event: React.MouseEvent<HTMLDivElement>) => {
		if (!onOpenRow) return;
		const target = event.target as HTMLElement;
		if (
			target.closest(
				"a, button, input, label, select, textarea, [role='button'], [contenteditable='true']",
			)
		)
			return;
		if (window.getSelection()?.toString()) return;
		const tr = target.closest('tbody tr');
		if (!tr) return;
		const body = tr.parentElement;
		const row = rowByIndex(Array.prototype.indexOf.call(body?.children ?? [], tr));
		if (row) onOpenRow(row);
	};

	if (source && cached.loading && !allRows.length) {
		return (
			<div className={s.collection} aria-busy="true">
				<div className={s.collectionTools} />
				<div className={s.tableSkeleton} />
			</div>
		);
	}

	return (
		<div className={`${s.collection} ${onOpenRow ? s.clickableRows : ''}`}>
			<SearchFilterBar
				label={label}
				query={q}
				onQueryChange={(value) => {
					setQ(value);
					setPage(1);
				}}
				fields={fields}
				filters={filters}
				onFiltersChange={(value) => {
					setFilters(value);
					setPage(1);
				}}
				period={period}
				onPeriodChange={handlePeriodChange}
				temporal={!!dateKey && showPeriodFilter}
				extra={extra}
			/>
			{dateKey && period && (
				<p className={s.footnote}>
					{dateMeaning ? `${dateMeaning} — ` : ''}
					{(() => {
						const { from, to } = resolvePeriod(period);
						const fmt = (d: Date) =>
							d.toLocaleString('pt-BR', {
								timeZone: TZ,
								day: '2-digit',
								month: '2-digit',
								hour: '2-digit',
								minute: '2-digit',
							});
						return `de ${fmt(from)} até ${fmt(to)} (horário de Brasília)`;
					})()}
				</p>
			)}

			{!total ? (
				<EmptyState
					title="Nenhum resultado encontrado"
					description="A combinação de busca e filtros não encontrou registros."
					action={
						<Button
							variant="secondary"
							onClick={() => {
								setQ('');
								setFilters([]);
								handlePeriodChange(null);
							}}
						>
							Limpar busca e filtros
						</Button>
					}
				/>
			) : (
				<>
					{/* biome-ignore lint/a11y/noStaticElementInteractions: pointer convenience layer */}
					{/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard path é o botão de nome da linha */}
					<div className={s.table} onClick={onTableClick}>
						<SortableDataTable
							rows={pageRows}
							columns={columns}
							rowKey="id"
							caption={label}
							resizable
							defaultSort={sort}
							onSortChange={(next) => {
								if (next) {
									setSort(next as SortState);
									setPage(1);
								}
							}}
							selectable={selectable}
							selectedKeys={selected}
							onSelectionChange={onSelectionChange}
							itemName={{ one: 'registro', other: 'registros' }}
						/>
					</div>
					<div className={s.pagination}>
						<span>
							{total}
							{!serverMode ? ` de ${allRows.length}` : ''} registros
							{selected?.length ? ` · ${selected.length} selecionados` : ''}
							{cached.refreshing ? ' · atualizando…' : ''}
						</span>
						<Pagination
							page={current}
							pageCount={pages}
							onPageChange={setPage}
							label={`Páginas de ${label}`}
						/>
					</div>
				</>
			)}
		</div>
	);
}
