import { describe, expect, test } from 'bun:test';
import { buildTimeline } from '@modules/admin/timeline-service';

const FROM = new Date('2026-10-22T00:00:00Z');
const TO = new Date('2026-10-22T02:00:00Z');
const at = (iso: string) => new Date(iso);

describe('deployment timeline aggregator', () => {
	test('buckets assigned events by createdAt and outcomes by snapshotAt', () => {
		const rows = [
			{
				createdAt: at('2026-10-22T00:30:00Z'),
				targetStatusSnapshot: {
					dev1: {
						controllerId: 'dev1',
						phase: 'installed',
						frozen: true,
						snapshotAt: '2026-10-22T01:10:00Z',
					},
					dev2: {
						controllerId: 'dev2',
						phase: 'error',
						frozen: true,
						snapshotAt: '2026-10-22T01:40:00Z',
					},
				},
			},
			{
				createdAt: at('2026-10-22T01:50:00Z'),
				targetStatusSnapshot: {
					dev1: {
						controllerId: 'dev1',
						phase: 'assigned',
						frozen: false,
						snapshotAt: '2026-10-22T01:55:00Z',
					},
				},
			},
		];
		const t = buildTimeline(rows, FROM, TO, 4);
		expect(t.bucketMs).toBe(30 * 60_000);
		expect(t.data[1].assigned).toBe(1); // 00:30 → bucket 1
		expect(t.data[2].installed).toBe(1); // 01:10 → bucket 2
		expect(t.data[3].failed).toBe(1); // 01:40 → bucket 3
		expect(t.data[3].assigned).toBe(1); // 01:50 → bucket 3
		expect(t.data.reduce((sum, b) => sum + b.installed, 0)).toBe(1);
	});

	test('fail in A stays in A; success in B is a separate event (decision #2)', () => {
		const rows = [
			{
				createdAt: at('2026-10-22T00:10:00Z'),
				targetStatusSnapshot: {
					dev1: {
						controllerId: 'dev1',
						phase: 'error',
						frozen: true,
						snapshotAt: '2026-10-22T00:20:00Z',
					},
				},
			},
			{
				createdAt: at('2026-10-22T00:40:00Z'),
				targetStatusSnapshot: {
					dev1: {
						controllerId: 'dev1',
						phase: 'installed',
						frozen: true,
						snapshotAt: '2026-10-22T00:50:00Z',
					},
				},
			},
		];
		const t = buildTimeline(rows, FROM, TO, 2);
		expect(t.data[0].failed).toBe(1);
		expect(t.data[0].installed).toBe(1);
	});

	test('non-terminal phases are current state, not history', () => {
		const rows = [
			{
				createdAt: at('2026-10-22T00:30:00Z'),
				targetStatusSnapshot: {
					dev1: {
						controllerId: 'dev1',
						phase: 'downloading',
						frozen: false,
						snapshotAt: '2026-10-22T00:35:00Z',
					},
				},
			},
		];
		const t = buildTimeline(rows, FROM, TO, 2);
		expect(t.data[0].assigned).toBe(1);
		expect(t.data[0].installed + t.data[0].failed + t.data[0].canceled).toBe(0);
	});

	test('events outside the window and invalid timestamps are ignored', () => {
		const rows = [
			{
				createdAt: at('2026-10-21T23:00:00Z'),
				targetStatusSnapshot: {
					dev1: {
						controllerId: 'dev1',
						phase: 'installed',
						frozen: true,
						snapshotAt: '2026-10-22T05:00:00Z',
					},
					dev2: { controllerId: 'dev2', phase: 'error', frozen: true, snapshotAt: 'lixo' },
				},
			},
		];
		const t = buildTimeline(rows, FROM, TO, 2);
		const totals = t.data.reduce(
			(acc, b) => ({
				a: acc.a + b.assigned,
				i: acc.i + b.installed,
				f: acc.f + b.failed,
				c: acc.c + b.canceled,
			}),
			{ a: 0, i: 0, f: 0, c: 0 },
		);
		expect(totals).toEqual({ a: 0, i: 0, f: 0, c: 0 });
	});
});
