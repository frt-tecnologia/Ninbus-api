type Point = { t: number; value: number };
export function linePath(
	points: Point[],
	from: number,
	to: number,
	x: (t: number) => number,
	y: (value: number) => number,
	width: number,
) {
	const slice = points.slice(Math.max(0, from), Math.min(points.length, to));
	if (!slice.length) return '';
	const parts: string[] = [];
	if (slice.length <= width * 2) {
		for (const point of slice) parts.push(`${x(point.t).toFixed(1)},${y(point.value).toFixed(1)}`);
	} else {
		let column = -1,
			low: Point | null = null,
			high: Point | null = null;
		const flush = () => {
			if (!low || !high) return;
			const pair = low.t < high.t ? [low, high] : [high, low];
			for (const point of pair) parts.push(`${x(point.t).toFixed(1)},${y(point.value).toFixed(1)}`);
		};
		for (const point of slice) {
			const at = Math.floor(x(point.t));
			if (at !== column) {
				flush();
				column = at;
				low = high = point;
				continue;
			}
			if (point.value < low!.value) low = point;
			if (point.value > high!.value) high = point;
		}
		flush();
	}
	return `M${parts.join('L')}`;
}
