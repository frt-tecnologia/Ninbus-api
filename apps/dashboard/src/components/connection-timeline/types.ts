export type TimeRange = readonly [number, number];
export type ConnectionState = 'online' | 'offline' | 'unknown';
export interface TimelineDevice {
	id: string;
	name: string;
	subtitle?: string;
	companyName?: string;
}
export interface ConnectionSegment {
	start: number;
	end: number;
	state: ConnectionState;
}
export interface TimelineRecord<T extends TimelineDevice = TimelineDevice> {
	device: T;
	segments: readonly ConnectionSegment[];
	onlineMs: number;
	offlineMs: number;
	unknownMs: number;
	availability: number | null;
}
export type TimelineRow<T extends TimelineDevice = TimelineDevice> =
	| {
			kind: 'company';
			company: string;
			companyLabel?: string;
			count: number;
			collapsed: boolean;
	  }
	| { kind: 'device'; record: TimelineRecord<T> };
export interface ConnectionTimelineProps<T extends TimelineDevice = TimelineDevice> {
	rows: readonly TimelineRow<T>[];
	range: TimeRange;
	domain?: TimeRange;
	overviewLabel?: string;
	overviewData?: readonly { date: number | Date; value: number }[];
	onRangeChange?: (range: [number, number]) => void;
	onDeviceSelect?: (record: TimelineRecord<T>, segment?: ConnectionSegment) => void;
	onCompanyToggle?: (company: string) => void;
	onViewChange?: (range: TimeRange) => void;
	dense?: boolean;
	showAvailability?: boolean;
	showIdentifiers?: boolean;
	showTooltip?: boolean;
	pageSize?: number;
	stickyTop?: number;
	minSpan?: number;
	timeZone?: string;
	locale?: string;
	resetKey?: string;
	className?: string;
}
