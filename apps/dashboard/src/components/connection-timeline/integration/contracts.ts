import type { BrushOverviewPoint } from '../brush-range/BrushRangeSelector';
import type { ConnectionState, TimelineDevice, TimeRange } from '../types';

export interface DashboardCompany {
	id: string;
	name: string;
}
export interface DashboardDevice {
	id: string;
	name: string;
	companyId: string | null;
	hawkbitTargetId: string | null;
	serialNumber: string | null;
	serialDisplay: string | null;
	connectionStatus: string | null;
	lastSeenAt: string | null;
	firmwareVersion?: string | null;
}
export interface ConnectionEvent {
	deviceId: string;
	deviceName: string | null;
	hawkbitTargetId: string | null;
	event: 'online' | 'offline';
	occurredAt: string;
	ipAddress: string | null;
}
export interface InitialDeviceState {
	deviceId: string;
	stateAtFrom: 'online' | 'offline' | null;
	since: string | null;
}
export interface CompanyHistoryPage {
	range: { from: string; to: string };
	data: ConnectionEvent[];
	total: number;
	states: InitialDeviceState[];
	hasMore: boolean;
}
export interface ConnectionQuery {
	companyIds: readonly string[];
	deviceId?: string;
	range: TimeRange;
}
export interface HistorySnapshot {
	range: TimeRange;
	events: readonly ConnectionEvent[];
	states: readonly InitialDeviceState[];
}
export interface ConnectionCatalog {
	companies: readonly DashboardCompany[];
	devices: readonly DashboardDevice[];
}
export interface ConnectionRepository {
	loadCatalog(signal: AbortSignal): Promise<ConnectionCatalog>;
	loadHistory(query: ConnectionQuery, signal: AbortSignal): Promise<HistorySnapshot>;
	loadOverview?(
		query: ConnectionQuery,
		signal: AbortSignal,
	): Promise<readonly BrushOverviewPoint[]>;
}
export interface DashboardDataSource {
	loadCatalog(signal: AbortSignal): Promise<ConnectionCatalog>;
	getEvents(
		companyId: string,
		query: {
			from: string;
			to: string;
			view: 'events';
			deviceId?: string;
			limit: number;
			offset: number;
		},
		signal: AbortSignal,
	): Promise<CompanyHistoryPage>;
	loadOverview?: ConnectionRepository['loadOverview'];
}
export interface ConnectionDevice extends TimelineDevice {
	companyId: string | null;
	connectionStatus: string | null;
	lastSeenAt: string | null;
	firmwareVersion: string | null;
}
export type HistoryStatus = 'all' | 'online' | 'offline' | 'unknown';
export type { ConnectionState };
