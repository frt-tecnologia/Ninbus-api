/**
 * Design-system barrel — single import point for the Ninbus "Fleet Control
 * Surface" primitives. Usage:
 *   import { Kpi, Signal, Pipeline, Section, Empty } from '@/components/system'
 */
export { Id } from './id';
export { Signal, SignalDot } from './signal';
export { Phase } from './phase';
export { Pipeline } from './pipeline';
export { Kpi } from './kpi';
export { Section, SectionHeader } from './section';
export { Field } from './field';
export { Toolbar } from './toolbar';
export { Empty, ErrorState, TableLoading } from './state';
export { Time, Relative } from './time';
