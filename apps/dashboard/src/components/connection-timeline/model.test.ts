import { expect, test } from 'bun:test';
import { buildSegments, createConnectionRecord, getPageRows, rowWindow, timeTicks } from './model';
import type { TimelineRow } from './types';

test('missing telemetry remains unknown and invalid sessions are discarded', () => {
	expect(
		buildSegments(
			[
				{ start: NaN, end: 40 },
				{ start: 30, end: 20 },
			],
			[0, 100],
		),
	).toEqual([{ start: 0, end: 100, state: 'unknown' }]);
});
test('known disconnection is preserved between sessions', () => {
	expect(
		buildSegments(
			[
				{ start: 10, end: 30 },
				{ start: 50, end: 80 },
			],
			[0, 100],
		),
	).toEqual([
		{ start: 0, end: 10, state: 'unknown' },
		{ start: 10, end: 30, state: 'online' },
		{ start: 30, end: 50, state: 'offline' },
		{ start: 50, end: 80, state: 'online' },
		{ start: 80, end: 100, state: 'offline' },
	]);
});
test('sessions before the filter window provide the initial known state', () => {
	expect(buildSegments([{ start: 0, end: 10 }], [20, 40])).toEqual([
		{ start: 20, end: 40, state: 'offline' },
	]);
});
test('overlapping sessions merge without mutating source events', () => {
	const sessions = [
		{ start: 20, end: 50 },
		{ start: 0, end: 30 },
		{ start: 50, end: 70 },
	];
	expect(buildSegments(sessions, [10, 90])).toEqual([
		{ start: 10, end: 70, state: 'online' },
		{ start: 70, end: 90, state: 'offline' },
	]);
	expect(sessions[0].end).toBe(50);
});
test('summary does not count unknown time as disconnected', () => {
	const record = createConnectionRecord(
		{ id: '1', name: 'Dispositivo' },
		[{ start: 10, end: 30 }],
		[0, 40],
	);
	expect(record.unknownMs).toBe(10);
	expect(record.offlineMs).toBe(10);
	expect(record.availability).toBeCloseTo(2 / 3);
	expect(
		createConnectionRecord({ id: '1', name: 'Dispositivo' }, [], [0, 40]).availability,
	).toBeNull();
});
test('company heading survives a page that starts inside its group', () => {
	const record = createConnectionRecord({ id: '1', name: 'Dispositivo' }, [], [0, 40]);
	const rows: TimelineRow[] = [
		{ kind: 'company', company: 'Empresa', count: 20, collapsed: false },
		...Array.from({ length: 20 }, (_, i) => ({
			kind: 'device' as const,
			record: { ...record, device: { id: String(i), name: String(i) } },
		})),
	];
	const page = getPageRows(rows, 1, 10);
	expect(page[0].kind).toBe('company');
	expect(page[1].kind).toBe('device');
	expect(page.length).toBe(11);
});
test('page scroll virtualization stays bounded and reaches the last row', () => {
	expect(rowWindow(0, 720, 52, 50).end).toBeLessThan(24);
	const last = rowWindow(2200, 720, 52, 50);
	expect(last.end).toBe(50);
	expect(rowWindow(5000, 0, 52, 50)).toEqual({ start: 50, end: 50 });
});
test('tick density adapts to small screens and keeps interval boundaries', () => {
	const mobile = timeTicks([0, 18 * 3600000], 200),
		desktop = timeTicks([0, 18 * 3600000], 900);
	expect(mobile.length).toBeLessThan(desktop.length);
	expect(mobile[0]).toBe(0);
	expect(mobile.at(-1)).toBe(18 * 3600000);
});
