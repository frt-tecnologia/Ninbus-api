'use client';

import {
	ArrowUpRight,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Minus,
	Plus,
	RotateCcw,
} from 'lucide-react';
import {
	type CSSProperties,
	type PointerEvent,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/arc/button/button';
import { EmptyState } from '@/components/arc/empty-state/empty-state';
import { Pagination } from '@/components/arc/pagination/pagination';
import { BrushRangeSelector } from './brush-range/BrushRangeSelector';
import { fitRange } from './brush-range/range-model';
import s from './ConnectionTimeline.module.css';
import { elapsed, getPageRows, stateLabels, timeTicks } from './model';
import type {
	ConnectionSegment,
	ConnectionTimelineProps,
	TimelineDevice,
	TimelineRecord,
	TimeRange,
} from './types';
import { useVisibleRows } from './useVisibleRows';

export function ConnectionTimeline<T extends TimelineDevice>({
	rows,
	range,
	domain,
	overviewData,
	overviewLabel,
	onRangeChange,
	onDeviceSelect,
	onCompanyToggle,
	onViewChange,
	dense = true,
	showAvailability = false,
	showIdentifiers = false,
	showTooltip = false,
	pageSize = 50,
	stickyTop = 0,
	minSpan = 60000,
	timeZone = 'America/Sao_Paulo',
	locale = 'pt-BR',
	resetKey = '',
	className,
}: ConnectionTimelineProps<T>) {
	const root = useRef<HTMLDivElement>(null),
		body = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(800),
		[page, setPage] = useState(0),
		[labelWidth, setLabelWidth] = useState(220);
	const [view, setView] = useState<TimeRange>(range);
	const [hover, setHover] = useState<{
		record: TimelineRecord<T>;
		segment: ConnectionSegment;
		at: number;
		x: number;
		y: number;
	} | null>(null);
	useLayoutEffect(() => {
		const node = root.current;
		if (!node) return;
		setWidth(node.clientWidth);
		const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
		observer.observe(node);
		return () => observer.disconnect();
	}, []);
	useEffect(() => {
		setView([range[0], range[1]]);
		setHover(null);
	}, [range[0], range[1]]);
	useEffect(() => {
		setPage(0);
		setHover(null);
	}, [resetKey, range[0], range[1], rows.length]);
	useEffect(() => {
		const clear = () => setHover(null);
		window.addEventListener('scroll', clear, { passive: true, capture: true });
		return () => window.removeEventListener('scroll', clear, true);
	}, []);
	const size = Number.isFinite(pageSize) ? Math.max(10, Math.floor(pageSize)) : 50;
	const pages = Math.max(1, Math.ceil(rows.length / size));
	const current = Math.min(page, pages - 1);
	const pageRows = useMemo(() => getPageRows(rows, current, size), [rows, current, size]);
	const small = width < 600,
		nameWidth = small ? 112 : labelWidth,
		resultWidth = small || !showAvailability ? 0 : 76;
	const plotWidth = Math.max(1, width - labelWidth - resultWidth);
	const rowHeight = small ? 44 : dense ? 38 : 54;
	const visible = useVisibleRows(body, pageRows.length, rowHeight);
	const bounds = domain ?? range;
	const from = Math.max(bounds[0], view[0]),
		to = Math.min(bounds[1], view[1]);
	const span = Math.max(1, to - from),
		fullSpan = Math.max(1, bounds[1] - bounds[0]);
	const ticks = useMemo(() => timeTicks([from, to], plotWidth), [from, to, plotWidth]);
	const hour = useMemo(
		() =>
			new Intl.DateTimeFormat(locale, {
				timeZone,
				hour: '2-digit',
				minute: '2-digit',
			}),
		[locale, timeZone],
	);
	const day = useMemo(
		() =>
			new Intl.DateTimeFormat(locale, {
				timeZone,
				day: '2-digit',
				month: '2-digit',
			}),
		[locale, timeZone],
	);
	const stamp = (at: number) => `${day.format(at)} · ${hour.format(at)}`;
	const grid = {
		gridTemplateColumns: `${nameWidth}px minmax(0,1fr) ${resultWidth}px`,
	} satisfies CSSProperties;
	const changeView = (next: TimeRange, commit = true) => {
		const target = fitRange(next, bounds, minSpan);
		setView(target);
		setHover(null);
		onViewChange?.(target);
		if (commit) onRangeChange?.(target);
	};
	const zoom = (factor: number) => {
		const nextSpan = Math.min(fullSpan, Math.max(Math.min(minSpan, fullSpan), span / factor));
		const start = Math.max(bounds[0], Math.min(bounds[1] - nextSpan, (from + to - nextSpan) / 2));
		changeView([start, start + nextSpan]);
	};
	const startResize = (event: PointerEvent<HTMLDivElement>) => {
		event.preventDefault();
		const startX = event.clientX,
			startWidth = labelWidth;
		const move = (moveEvent: globalThis.PointerEvent) =>
			setLabelWidth(Math.max(112, Math.min(480, startWidth + moveEvent.clientX - startX)));
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	};
	const changePage = (next: number) => {
		setPage(Math.max(0, Math.min(pages - 1, next)));
		setHover(null);
		root.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
	};
	const position = (at: number) => ((at - from) / span) * 1000;
	const segmentAt = (event: PointerEvent<HTMLButtonElement>, record: TimelineRecord<T>) => {
		const box = event.currentTarget.getBoundingClientRect();
		const at =
			from + Math.max(0, Math.min(1, (event.clientX - box.left) / Math.max(1, box.width))) * span;
		return {
			at,
			segment: record.segments.find((segment) => at >= segment.start && at < segment.end),
		};
	};
	const inspect = (event: PointerEvent<HTMLButtonElement>, record: TimelineRecord<T>) => {
		if (!showTooltip || event.pointerType !== 'mouse') return;
		const { at, segment } = segmentAt(event, record);
		if (!segment) return;
		setHover({
			record,
			segment,
			at,
			x: Math.min(window.innerWidth - 268, Math.max(8, event.clientX - 125)),
			y: event.clientY > window.innerHeight - 120 ? event.clientY - 110 : event.clientY + 16,
		});
	};
	const pagination =
		pages > 1 ? (
			<Pagination
				page={current + 1}
				pageCount={pages}
				onPageChange={(page) => changePage(page - 1)}
				label="Páginas de dispositivos"
			/>
		) : null;

	if (!Number.isFinite(range[0]) || !Number.isFinite(range[1]) || range[0] >= range[1])
		return <p role="alert">Selecione um intervalo de tempo válido.</p>;
	return (
		<div ref={root} className={[s.root, className].filter(Boolean).join(' ')}>
			<div className={s.toolbar}>
				<div className={s.legend}>
					<span>
						<i className={s.onlineDot} />
						Conectado
					</span>
					<span>
						<i className={s.offlineDot} />
						Desconectado
					</span>
					<span>
						<i className={s.unknownDot} />
						Sem histórico
					</span>
				</div>
				<div className={s.controls}>
					<Button
						variant="ghost"
						size="sm"
						disabled={span >= fullSpan - 1}
						onClick={() => zoom(0.5)}
						aria-label="Reduzir zoom"
					>
						<Minus size={15} />
					</Button>
					<span className={s.zoomValue}>
						{(fullSpan / span).toLocaleString(locale, {
							maximumFractionDigits: 1,
						})}
						×
					</span>
					<Button
						variant="ghost"
						size="sm"
						disabled={span <= Math.min(minSpan, fullSpan)}
						onClick={() => zoom(2)}
						aria-label="Aumentar zoom"
					>
						<Plus size={15} />
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => changeView([bounds[0], bounds[1]])}
						disabled={span >= fullSpan - 1}
						aria-label="Mostrar período completo"
					>
						<RotateCcw size={14} />
					</Button>
				</div>
			</div>
			<div className={s.brushRow}>
				{overviewData?.length ? <span className={s.brushLabel}>{overviewLabel}</span> : null}
				<div className={s.brushControl}>
					<BrushRangeSelector
						data={overviewData}
						domain={bounds}
						range={[from, to]}
						minSpan={minSpan}
						onRangeChange={(next) => changeView(next, false)}
						onRangeCommit={(next) => changeView(next, true)}
						formatDate={(date) => stamp(date.getTime())}
					/>
					<div className={s.domainLabels}>
						<span>{stamp(bounds[0])}</span>
						<span>{stamp(bounds[1])}</span>
					</div>
				</div>
			</div>

			<div className={s.axis} style={{ ...grid, top: stickyTop }}>
				<div className={s.nameAxis}>Dispositivo</div>
				<div className={s.timeAxis}>
					{ticks.map((tick, index) => (
						<div
							key={tick}
							className={`${s.tick} ${index === 0 ? s.first : index === ticks.length - 1 ? s.last : ''}`}
							style={{ left: `${((tick - from) / span) * 100}%` }}
						>
							<span>{span > 172800000 ? day.format(tick) : hour.format(tick)}</span>
							<small>{span > 172800000 ? hour.format(tick) : day.format(tick)}</small>
						</div>
					))}
				</div>
				{!small && showAvailability && (
					<div
						className={s.ratioAxis}
						title="Percentual conectado no intervalo completo com histórico conhecido"
					>
						Conectado
					</div>
				)}
				{!small && (
					<div
						className={s.nameResize}
						onPointerDown={startResize}
						role="separator"
						aria-orientation="vertical"
						aria-label="Redimensionar coluna de dispositivos"
						style={{ insetInlineStart: nameWidth }}
					/>
				)}
			</div>
			<div
				ref={body}
				className={s.body}
				style={{ height: pageRows.length * rowHeight }}
				onPointerLeave={() => setHover(null)}
			>
				{pageRows.slice(visible.start, visible.end).map((row, index) => {
					const style = {
						...grid,
						height: rowHeight,
						top: (visible.start + index) * rowHeight,
					};
					if (row.kind === 'company')
						return (
							<div key={`company:${row.company}`} className={s.companyRow} style={style}>
								<button
									type="button"
									onClick={() => onCompanyToggle?.(row.company)}
									disabled={!onCompanyToggle}
									aria-expanded={!row.collapsed}
								>
									{row.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
									<span>{row.companyLabel ?? row.company}</span>
									<small>{row.count.toLocaleString(locale)}</small>
								</button>
							</div>
						);
					const record = row.record,
						d = record.device;
					const segments = record.segments.filter(
						(segment) => segment.end > from && segment.start < to,
					);
					const summary = `${d.name}: ${elapsed(record.onlineMs)} conectado, ${elapsed(record.offlineMs)} desconectado, ${elapsed(record.unknownMs)} sem histórico.`;
					return (
						<div key={d.id} className={s.deviceRow} style={style}>
							<button
								type="button"
								className={s.name}
								title={`${d.name} · ${d.subtitle ?? d.id}${d.companyName ? ` · ${d.companyName}` : ''}`}
								onClick={() => onDeviceSelect?.(record)}
							>
								<span>
									{d.name}
									<ArrowUpRight size={12} />
								</span>
								{showIdentifiers && <small>{d.subtitle ?? d.id}</small>}
							</button>
							<button
								type="button"
								className={s.plot}
								aria-label={`${summary} Abrir detalhes.`}
								onPointerMove={(event) => inspect(event, record)}
								onClick={(event) => {
									setHover(null);
									const box = event.currentTarget.getBoundingClientRect();
									const at = from + ((event.clientX - box.left) / Math.max(1, box.width)) * span;
									onDeviceSelect?.(
										record,
										event.detail
											? record.segments.find((segment) => at >= segment.start && at < segment.end)
											: undefined,
									);
								}}
							>
								<svg
									viewBox={`0 0 1000 ${rowHeight}`}
									preserveAspectRatio="none"
									aria-hidden="true"
								>
									<g>
										{ticks.map((tick) => (
											<line
												key={tick}
												x1={position(tick)}
												x2={position(tick)}
												y1={0}
												y2={rowHeight}
												className={s.grid}
											/>
										))}
									</g>
									<g>
										<rect
											x={0}
											y={rowHeight / 2 - (small || !dense ? 4 : 3)}
											width={1000}
											height={small || !dense ? 8 : 6}
											className={s.unknown}
										/>
										{segments.map((segment) => (
											<rect
												key={`${segment.start}:${segment.state}`}
												x={position(Math.max(segment.start, from))}
												y={rowHeight / 2 - (small || !dense ? 4 : 3)}
												width={Math.max(
													0.1,
													position(Math.min(segment.end, to)) -
														position(Math.max(segment.start, from)),
												)}
												height={small || !dense ? 8 : 6}
												className={s[segment.state]}
											/>
										))}
									</g>
									{hover && (
										<line
											x1={position(hover.at)}
											x2={position(hover.at)}
											y1={0}
											y2={rowHeight}
											className={s.cursor}
										/>
									)}
								</svg>
							</button>
							{!small && showAvailability && (
								<button
									type="button"
									className={s.ratio}
									title={
										record.availability === null
											? 'Sem histórico'
											: `${Math.round(record.availability * 100)}% no tempo observado do período completo`
									}
									onClick={() => onDeviceSelect?.(record)}
								>
									{record.availability === null ? '—' : `${Math.round(record.availability * 100)}%`}
									{record.unknownMs > 0 && record.availability !== null && <small>parcial</small>}
								</button>
							)}
						</div>
					);
				})}
			</div>
			{!rows.length && (
				<EmptyState title="Nenhum dispositivo" description="Altere a busca ou os filtros." />
			)}
			{pagination && <div className={s.footer}>{pagination}</div>}
			{hover &&
				createPortal(
					<div
						className={s.tooltip}
						role="tooltip"
						style={{ left: Math.max(8, hover.x), top: hover.y }}
					>
						<strong>
							{hover.record.device.name}
							<i className={s[`${hover.segment.state}Dot`]} />
						</strong>
						<span>
							{stateLabels[hover.segment.state]} ·{' '}
							{elapsed(hover.segment.end - hover.segment.start)}
						</span>
						<small>
							{stamp(hover.segment.start)} → {stamp(hover.segment.end)}
						</small>
					</div>,
					document.body,
				)}
		</div>
	);
}
