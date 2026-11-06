import type { ConnectionSegment, TimelineRecord, TimeRange } from '../types';
import type {
	ConnectionCatalog,
	ConnectionDevice,
	ConnectionEvent,
	DashboardDevice,
	HistorySnapshot,
	InitialDeviceState,
} from './contracts';

export function segmentsFromEvents(
	events: readonly ConnectionEvent[],
	initial: InitialDeviceState | undefined,
	range: TimeRange,
): ConnectionSegment[] {
	let state: ConnectionSegment['state'] = initial?.stateAtFrom ?? 'unknown';
	let cursor = range[0];
	const segments: ConnectionSegment[] = [];
	const sorted = events
		.map((event, index) => ({
			...event,
			index,
			at: Date.parse(event.occurredAt),
		}))
		.filter((event) => Number.isFinite(event.at) && event.at >= range[0] && event.at <= range[1])
		.sort((a, b) => a.at - b.at || a.index - b.index);
	const append = (end: number) => {
		if (end <= cursor) return;
		const last = segments.at(-1);
		if (last?.state === state && last.end === cursor) last.end = end;
		else segments.push({ start: cursor, end, state });
		cursor = end;
	};
	for (const event of sorted) {
		append(event.at);
		state = event.event;
	}
	append(range[1]);
	return segments;
}
export function recordsFromHistory(
	catalog: ConnectionCatalog,
	devices: readonly DashboardDevice[],
	snapshot: HistorySnapshot,
): TimelineRecord<ConnectionDevice>[] {
	const companies = new Map(catalog.companies.map((company) => [company.id, company.name]));
	const states = new Map(snapshot.states.map((state) => [state.deviceId, state]));
	const events = new Map<string, ConnectionEvent[]>();
	for (const event of snapshot.events) {
		const group = events.get(event.deviceId);
		if (group) group.push(event);
		else events.set(event.deviceId, [event]);
	}
	return devices.map((device) => {
		const segments = segmentsFromEvents(
			events.get(device.id) ?? [],
			states.get(device.id),
			snapshot.range,
		);
		const duration = { online: 0, offline: 0, unknown: 0 };
		for (const segment of segments) duration[segment.state] += segment.end - segment.start;
		return {
			device: {
				id: device.id,
				name: device.name,
				companyId: device.companyId,
				companyName: device.companyId
					? (companies.get(device.companyId) ?? 'Empresa indisponível')
					: 'Sem empresa',
				subtitle:
					device.serialDisplay ?? device.serialNumber ?? device.hawkbitTargetId ?? undefined,
				connectionStatus: device.connectionStatus,
				lastSeenAt: device.lastSeenAt,
				firmwareVersion: device.firmwareVersion ?? null,
			},
			segments,
			onlineMs: duration.online,
			offlineMs: duration.offline,
			unknownMs: duration.unknown,
			availability:
				duration.online + duration.offline
					? (duration.online / (duration.online + duration.offline)) * 100
					: null,
		};
	});
}
export const normalizeSearch = (value: string) =>
	value
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLocaleLowerCase('pt-BR');
export const rangeLabel = (range: TimeRange) => {
	const fmt = new Intl.DateTimeFormat('pt-BR', {
		timeZone: 'America/Sao_Paulo',
		day: '2-digit',
		month: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	});
	return `${fmt.format(range[0])} → ${fmt.format(range[1])}`;
};
