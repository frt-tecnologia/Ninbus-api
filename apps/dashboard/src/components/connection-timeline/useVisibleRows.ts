import { type RefObject, useLayoutEffect, useState } from 'react';
import { rowWindow } from './model';

function scrollParent(node: HTMLElement): HTMLElement | Window {
	let parent = node.parentElement;
	while (parent && parent !== document.body) {
		if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
		parent = parent.parentElement;
	}
	return window;
}

export function useVisibleRows(
	ref: RefObject<HTMLDivElement | null>,
	count: number,
	rowHeight: number,
) {
	const [visible, setVisible] = useState({
		start: 0,
		end: Math.min(count, 16),
	});
	useLayoutEffect(() => {
		const node = ref.current;
		if (!node) return;
		const parent = scrollParent(node);
		let frame = 0;
		const update = () => {
			frame = 0;
			const top = node.getBoundingClientRect().top;
			const parentTop =
				parent instanceof HTMLElement ? parent.getBoundingClientRect().top + parent.clientTop : 0;
			const viewport = parent instanceof HTMLElement ? parent.clientHeight : window.innerHeight;
			const offset = Math.max(0, parentTop - top);
			const height = Math.max(
				0,
				Math.min(viewport, top - parentTop + count * rowHeight) - Math.max(0, top - parentTop),
			);
			const next = rowWindow(offset, height, rowHeight, count);
			setVisible((old) => (old.start === next.start && old.end === next.end ? old : next));
		};
		const schedule = () => {
			if (!frame) frame = requestAnimationFrame(update);
		};
		update();
		parent.addEventListener('scroll', schedule, { passive: true });
		window.addEventListener('resize', schedule, { passive: true });
		if (parent !== window) window.addEventListener('scroll', schedule, { passive: true });
		const observer = new ResizeObserver(schedule);
		observer.observe(node);
		return () => {
			parent.removeEventListener('scroll', schedule);
			window.removeEventListener('resize', schedule);
			if (parent !== window) window.removeEventListener('scroll', schedule);
			observer.disconnect();
			cancelAnimationFrame(frame);
		};
	}, [ref, count, rowHeight]);
	return visible;
}
