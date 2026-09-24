/**
 * Design-system barrel — single import point for the Ninbus "Fleet Control
 * Surface" primitives. Usage:
 *   import { Kpi, Signal, Pipeline, Section, Empty } from '@/components/system'
 */

export { BarMeter } from './bar-meter';
export { Field } from './field';
export { Id } from './id';
export { Kpi } from './kpi';
export { Phase } from './phase';
export { Pipeline } from './pipeline';
export { SearchField } from './search-field';
export { Section, SectionHeader } from './section';
export { Signal, SignalDot } from './signal';
export { Empty, ErrorState, TableLoading } from './state';
export { Relative, Time } from './time';
export {
	last1h,
	last7d,
	last24h,
	last30d,
	PRESETS,
	RangeProvider,
	rangeFromHours,
	type TimeRange,
	useRange,
} from './time-range-context';
export { TimeRangePicker, TimeRangePickerStandalone } from './time-range-picker';
export { Toolbar } from './toolbar';
