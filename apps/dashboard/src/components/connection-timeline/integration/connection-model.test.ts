import { expect, test } from 'bun:test';
import { recordsFromHistory, segmentsFromEvents } from './connection-model';
import type { ConnectionCatalog, ConnectionEvent } from './contracts';

const iso = (at: number) => new Date(at).toISOString();
const event = (at: number, state: 'online' | 'offline'): ConnectionEvent => ({
	deviceId: 'd1',
	deviceName: null,
	hawkbitTargetId: null,
	event: state,
	occurredAt: iso(at),
	ipAddress: null,
});
test('estado anterior online ancora a janela sem novos eventos', () => {
	expect(
		segmentsFromEvents([], { deviceId: 'd1', stateAtFrom: 'online', since: iso(0) }, [10, 100]),
	).toEqual([{ start: 10, end: 100, state: 'online' }]);
});
test('estado anterior offline e transições cobrem a janela uma única vez', () => {
	expect(
		segmentsFromEvents(
			[event(50, 'offline'), event(30, 'online')],
			{ deviceId: 'd1', stateAtFrom: 'offline', since: iso(0) },
			[10, 100],
		),
	).toEqual([
		{ start: 10, end: 30, state: 'offline' },
		{ start: 30, end: 50, state: 'online' },
		{ start: 50, end: 100, state: 'offline' },
	]);
});
test('ausência de estado inicial não fabrica desconexão', () => {
	expect(segmentsFromEvents([event(30, 'online')], undefined, [10, 100])).toEqual([
		{ start: 10, end: 30, state: 'unknown' },
		{ start: 30, end: 100, state: 'online' },
	]);
});
test('transições repetidas e limites exatos não criam intervalos vazios', () => {
	const events = [event(10, 'online'), event(25, 'online'), event(100, 'offline')];
	expect(segmentsFromEvents(events, undefined, [10, 100])).toEqual([
		{ start: 10, end: 100, state: 'online' },
	]);
	expect(events[0].occurredAt).toBe(iso(10));
});
test('junção usa UUID do cadastro e mantém dispositivos sem telemetria', () => {
	const catalog: ConnectionCatalog = {
		companies: [{ id: 'c1', name: 'Empresa' }],
		devices: [
			{
				id: 'd1',
				name: 'Nome do cadastro',
				companyId: 'c1',
				hawkbitTargetId: null,
				serialNumber: '123',
				serialDisplay: '123',
				connectionStatus: 'online',
				lastSeenAt: null,
			},
			{
				id: 'd2',
				name: 'Sem dados',
				companyId: 'c1',
				hawkbitTargetId: null,
				serialNumber: null,
				serialDisplay: null,
				connectionStatus: 'online',
				lastSeenAt: null,
			},
		],
	};
	const records = recordsFromHistory(catalog, catalog.devices, {
		range: [10, 100],
		states: [],
		events: [event(30, 'online'), { ...event(40, 'online'), deviceId: 'removido' }],
	});
	expect(records).toHaveLength(2);
	expect(records[0].device.name).toBe('Nome do cadastro');
	expect(records[0].onlineMs).toBe(70);
	expect(records[0].unknownMs).toBe(20);
	expect(records[1].unknownMs).toBe(90);
	expect(records[1].availability).toBeNull();
});

test('empresas homônimas permanecem separadas por UUID', async () => {
	const { groupConnectionRecords, filterConnectionRecords } = await import(
		'./connection-presentation-model'
	);
	const records = ['c1', 'c2'].map((companyId, index) => ({
		device: {
			id: `d${index}`,
			name: `Ônibus ${index}`,
			companyId,
			companyName: 'Empresa',
			connectionStatus: null,
			lastSeenAt: null,
			firmwareVersion: null,
		},
		segments: [],
		onlineMs: 0,
		offlineMs: 0,
		unknownMs: 90,
		availability: null,
	}));
	const filtered = filterConnectionRecords(records, 'onibus', 'unknown', [10, 100]);
	const rows = groupConnectionRecords(filtered, new Set(['c1']), true);
	expect(filtered).toHaveLength(2);
	expect(rows).toHaveLength(3);
	expect(rows[0]).toMatchObject({
		kind: 'company',
		company: 'c1',
		companyLabel: 'Empresa',
		collapsed: true,
	});
	expect(rows[1]).toMatchObject({
		kind: 'company',
		company: 'c2',
		collapsed: false,
	});
});
