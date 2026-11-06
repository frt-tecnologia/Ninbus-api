'use client';

import { animate, useReducedMotion } from 'motion/react';
import {
	type KeyboardEvent,
	type PointerEvent,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { motionTokens } from '@/components/arc/lib/motion-tokens';
import styles from './brush-chart.module.css';
import { linePath } from './line-path';
import { type DragMode, dragRange, fitRange, type Range } from './range-model';

export interface BrushOverviewPoint {
	date: number | Date;
	value: number;
}
export interface BrushRangeSelectorProps {
	data?: readonly BrushOverviewPoint[];
	domain: Range;
	range: Range;
	onRangeChange: (range: [number, number]) => void;
	onRangeCommit?: (range: [number, number]) => void;
	minSpan?: number;
	height?: number;
	label?: string;
	formatDate?: (date: Date) => string;
}

export function BrushRangeSelector({
	data = [],
	domain,
	range,
	onRangeChange,
	onRangeCommit,
	minSpan = 60000,
	height = 44,
	label = 'Período de conexão',
	formatDate = (date) => date.toISOString(),
}: BrushRangeSelectorProps) {
	const strip = useRef<HTMLFieldSetElement>(null);
	const [width, setWidth] = useState(0),
		[view, setView] = useState<[number, number]>(() => fitRange(range, domain, minSpan));
	const viewRef = useRef(view);
	const callbacks = useRef({ onRangeChange, onRangeCommit });
	callbacks.current = { onRangeChange, onRangeCommit };
	const drag = useRef<{
		mode: DragMode;
		pointerX: number;
		from: Range;
		anchor: number;
		moved: boolean;
	} | null>(null);
	const flight = useRef<{ stop: () => void } | null>(null);
	const reduced = useReducedMotion();
	const uid = `brush${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
	const first = domain[0],
		last = domain[1],
		full = Math.max(1, last - first);
	const points = useMemo(
		() =>
			data
				.map((point) => ({
					t: typeof point.date === 'number' ? point.date : point.date.getTime(),
					value: point.value,
				}))
				.filter((point) => Number.isFinite(point.t) && Number.isFinite(point.value))
				.sort((a, b) => a.t - b.t),
		[data],
	);
	useLayoutEffect(() => {
		const node = strip.current;
		if (!node) return;
		setWidth(node.clientWidth);
		const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
		observer.observe(node);
		return () => observer.disconnect();
	}, []);
	useEffect(() => {
		if (drag.current) return;
		const target = fitRange(range, [first, last], minSpan),
			current = viewRef.current;
		if (Math.abs(target[0] - current[0]) + Math.abs(target[1] - current[1]) < 1) return;
		flight.current?.stop();
		const place = (next: [number, number]) => {
			viewRef.current = next;
			setView(next);
		};
		if (reduced) {
			place(target);
			return;
		}
		flight.current = animate(0, 1, {
			...motionTokens.spring.smooth,
			onUpdate: (progress) =>
				place([
					current[0] + (target[0] - current[0]) * progress,
					current[1] + (target[1] - current[1]) * progress,
				]),
		});
		return () => flight.current?.stop();
	}, [range[0], range[1], first, last, minSpan, reduced]);
	useEffect(() => () => flight.current?.stop(), []);
	const place = (next: Range) => {
		const target = fitRange(next, [first, last], minSpan);
		flight.current?.stop();
		viewRef.current = target;
		setView(target);
		callbacks.current.onRangeChange(target);
		return target;
	};
	const commit = (next: Range) => {
		const target = place(next);
		callbacks.current.onRangeCommit?.(target);
	};
	const toTime = (clientX: number) => {
		const rect = strip.current?.getBoundingClientRect();
		return rect?.width
			? first + Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * full
			: first;
	};
	const ox = (at: number) => ((at - first) / full) * width;
	const start = fitRange(view, [first, last], minSpan)[0],
		end = fitRange(view, [first, last], minSpan)[1];
	const x0 = ox(start),
		x1 = ox(end);
	const overview = useMemo(() => {
		if (!width || points.length < 2) return { line: '', area: '' };
		const max = points.reduce((max, point) => Math.max(max, point.value), 1);
		const path = linePath(
			points,
			0,
			points.length,
			(at) => ((at - first) / full) * width,
			(value) => 4 + (1 - value / max) * (height - 4),
			width,
		);
		return { line: path, area: `${path}L${width},${height}L0,${height}Z` };
	}, [points, width, first, full, height]);
	const onDown = (event: PointerEvent<HTMLFieldSetElement>) => {
		if (event.button > 0 || last <= first) return;
		const rect = event.currentTarget.getBoundingClientRect(),
			px = event.clientX - rect.left;
		const mode: DragMode =
			Math.abs(px - x0) <= 14 && px <= (x0 + x1) / 2
				? 'start'
				: Math.abs(px - x1) <= 14
					? 'end'
					: px > x0 && px < x1
						? 'pan'
						: 'new';
		drag.current = {
			mode,
			pointerX: event.clientX,
			from: [...viewRef.current],
			anchor: toTime(event.clientX),
			moved: false,
		};
		event.currentTarget.setPointerCapture(event.pointerId);
		flight.current?.stop();
	};
	const onMove = (event: PointerEvent<HTMLFieldSetElement>) => {
		const current = drag.current;
		if (!current) return;
		if (!current.moved && Math.abs(event.clientX - current.pointerX) < 3) return;
		current.moved = true;
		place(
			dragRange(
				current.mode,
				current.from,
				current.anchor,
				toTime(event.clientX),
				[first, last],
				minSpan,
			),
		);
	};
	const onUp = () => {
		const current = drag.current;
		drag.current = null;
		if (!current) return;
		if (!current.moved && current.mode === 'new') {
			const half = (viewRef.current[1] - viewRef.current[0]) / 2;
			commit([current.anchor - half, current.anchor + half]);
		} else callbacks.current.onRangeCommit?.(viewRef.current);
	};
	const onCancel = () => {
		const previous = drag.current?.from;
		drag.current = null;
		if (previous) place(previous);
	};
	const onKey = (event: KeyboardEvent<HTMLDivElement>, edge: 'start' | 'end' | 'window') => {
		const [s, e] = viewRef.current,
			span = e - s,
			least = Math.min(minSpan, full),
			big = event.shiftKey || event.key.startsWith('Page');
		const direction = (
			{
				ArrowLeft: -1,
				ArrowDown: -1,
				PageDown: -1,
				ArrowRight: 1,
				ArrowUp: 1,
				PageUp: 1,
			} as Record<string, number>
		)[event.key];
		let next: Range | null = null;
		if (event.key === 'Escape' || event.key === '0') next = [first, last];
		else if (edge === 'window' && (event.key === '+' || event.key === '='))
			next = [s + span / 4, e - span / 4];
		else if (edge === 'window' && (event.key === '-' || event.key === '_'))
			next = [s - span / 2, e + span / 2];
		else if (event.key === 'Home')
			next = edge === 'end' ? [s, s + least] : [first, edge === 'window' ? first + span : e];
		else if (event.key === 'End')
			next = edge === 'start' ? [e - least, e] : [edge === 'window' ? last - span : s, last];
		else if (direction) {
			const move =
				direction *
				(edge === 'window' ? span * (big ? 0.5 : 0.1) : Math.max(least, 60000) * (big ? 10 : 1));
			next =
				edge === 'window'
					? [s + move, e + move]
					: edge === 'start'
						? [Math.min(s + move, e - least), e]
						: [s, Math.max(e + move, s + least)];
		}
		if (next) {
			event.preventDefault();
			commit(next);
		}
	};
	const rangeText = `${formatDate(new Date(start))} → ${formatDate(new Date(end))}`;
	return (
		<fieldset
			ref={strip}
			className={styles.strip}
			style={{ height, border: 0, padding: 0, margin: 0, minWidth: 0 }}
			aria-label={label}
			onPointerDown={onDown}
			onPointerMove={onMove}
			onPointerUp={onUp}
			onPointerCancel={onCancel}
			onDoubleClick={() => commit([first, last])}
		>
			<svg className={styles.svg} width="100%" height={height} aria-hidden="true" focusable="false">
				<defs>
					<clipPath id={`${uid}-window`}>
						<rect x={x0} y={-2} width={Math.max(0, x1 - x0)} height={height + 4} />
					</clipPath>
				</defs>
				<path className={styles.overviewArea} d={overview.area} />
				<path className={styles.overviewLine} d={overview.line} />
				<g clipPath={`url(#${uid}-window)`}>
					<path className={styles.overviewAreaIn} d={overview.area} />
					<path className={styles.overviewLineIn} d={overview.line} />
				</g>
			</svg>
			<div className={styles.shade} data-edge="start" style={{ left: 0, width: Math.max(0, x0) }} />
			<div className={styles.shade} data-edge="end" style={{ left: x1, right: 0 }} />
			<div
				className={styles.window}
				style={{ left: x0, width: Math.max(0, x1 - x0) }}
				role="slider"
				tabIndex={0}
				aria-label="Mover intervalo"
				aria-roledescription="janela de tempo"
				aria-orientation="horizontal"
				aria-valuemin={first}
				aria-valuemax={last}
				aria-valuenow={Math.round(start)}
				aria-valuetext={rangeText}
				onKeyDown={(event) => onKey(event, 'window')}
			/>
			<div
				className={styles.handle}
				style={{ left: x0 }}
				role="slider"
				tabIndex={0}
				aria-label="Início do intervalo"
				aria-orientation="horizontal"
				aria-valuemin={first}
				aria-valuemax={Math.round(end - Math.min(minSpan, full))}
				aria-valuenow={Math.round(start)}
				aria-valuetext={formatDate(new Date(start))}
				onKeyDown={(event) => onKey(event, 'start')}
			>
				<span className={styles.grip} />
			</div>
			<div
				className={styles.handle}
				style={{ left: x1 }}
				role="slider"
				tabIndex={0}
				aria-label="Fim do intervalo"
				aria-orientation="horizontal"
				aria-valuemin={Math.round(start + Math.min(minSpan, full))}
				aria-valuemax={last}
				aria-valuenow={Math.round(end)}
				aria-valuetext={formatDate(new Date(end))}
				onKeyDown={(event) => onKey(event, 'end')}
			>
				<span className={styles.grip} />
			</div>
		</fieldset>
	);
}
