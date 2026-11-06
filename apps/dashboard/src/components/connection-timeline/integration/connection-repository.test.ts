import { expect, test } from 'bun:test';
import { createConnectionRepository } from './connection-repository';
import type { CompanyHistoryPage } from './contracts';

const range = [0, 100] as const;
const page = (extra: Partial<CompanyHistoryPage> = {}): CompanyHistoryPage => ({
	range: { from: new Date(0).toISOString(), to: new Date(100).toISOString() },
	data: [],
	states: [],
	total: 0,
	hasMore: false,
	...extra,
});
const catalog = async () => ({ companies: [], devices: [] });
test('percorre páginas de eventos e preserva o estado inicial', async () => {
	const offsets: number[] = [];
	const repository = createConnectionRepository({
		loadCatalog: catalog,
		async getEvents(id, query) {
			offsets.push(query.offset);
			expect(query.view).toBe('events');
			expect(id).toBe('c1');
			expect(query.deviceId).toBe('d1');
			return page({
				data:
					query.offset === 0
						? [
								{
									deviceId: 'd1',
									deviceName: null,
									hawkbitTargetId: null,
									event: 'online',
									occurredAt: new Date(30).toISOString(),
									ipAddress: null,
								},
							]
						: [],
				states: [
					{
						deviceId: 'd1',
						stateAtFrom: 'offline',
						since: new Date(-1).toISOString(),
					},
				],
				total: 10,
				hasMore: true,
			});
		},
	});
	const snapshot = await repository.loadHistory(
		{ companyIds: ['c1', 'c1'], deviceId: 'd1', range },
		new AbortController().signal,
	);
	expect(offsets).toEqual([0, 1]);
	expect(snapshot.events).toHaveLength(1);
	expect(snapshot.states).toHaveLength(1);
});
test('limita concorrência entre empresas e não consulta escopo vazio', async () => {
	let active = 0,
		max = 0,
		calls = 0;
	const repository = createConnectionRepository({
		loadCatalog: catalog,
		async getEvents() {
			calls++;
			active++;
			max = Math.max(max, active);
			await Promise.resolve();
			active--;
			return page();
		},
	});
	await repository.loadHistory({ companyIds: [], range }, new AbortController().signal);
	expect(calls).toBe(0);
	await repository.loadHistory(
		{ companyIds: ['a', 'b', 'c', 'd', 'e'], range },
		new AbortController().signal,
	);
	expect(max).toBeLessThanOrEqual(3);
	expect(calls).toBe(5);
});
test('propaga erro sem apresentar histórico parcial como completo', async () => {
	const repository = createConnectionRepository({
		loadCatalog: catalog,
		async getEvents() {
			throw new Error('Sem acesso');
		},
	});
	await expect(
		repository.loadHistory({ companyIds: ['a'], range }, new AbortController().signal),
	).rejects.toThrow('Sem acesso');
});
test('descarta resposta de janela incorreta e respeita cancelamento', async () => {
	const repository = createConnectionRepository({
		loadCatalog: catalog,
		async getEvents() {
			return page({
				range: {
					from: new Date(1).toISOString(),
					to: new Date(100).toISOString(),
				},
			});
		},
	});
	await await expect(
		repository.loadHistory({ companyIds: ['a'], range }, new AbortController().signal),
	).rejects.toThrow('período');
	const controller = new AbortController();
	controller.abort();
	await await expect(
		repository.loadHistory({ companyIds: ['a'], range }, controller.signal),
	).rejects.toThrow();
});

test('normaliza frações da janela antes de comparar a resposta ISO', async () => {
	const repository = createConnectionRepository({
		loadCatalog: catalog,
		async getEvents(_companyId, query) {
			expect(query.from).toBe(new Date(0).toISOString());
			expect(query.to).toBe(new Date(100).toISOString());
			return page();
		},
	});
	const snapshot = await repository.loadHistory(
		{ companyIds: ['a'], range: [0.75, 100.25] },
		new AbortController().signal,
	);
	expect(snapshot.range).toEqual([0, 100]);
});
