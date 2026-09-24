/**
 * Chart primitives barrel — pure-SVG/HTML, theme-aware, hover-enabled.
 * No chart library: each primitive reads the SIGNAL token system
 * (lib/design/tokens → globals.css --signal-*) so light/dark share one look.
 *
 * Usage:
 *   import { ActivityChart, StackedBars, Gauge } from '@/components/system/charts'
 */
export { ActivityChart } from './activity-chart';
export type { DonutSegment } from './deployment-donut';
export { DeploymentDonut } from './deployment-donut';
export type { GaugeSegment } from './gauge';
export { Gauge } from './gauge';
export {
	BRAND_FILL,
	BRAND_FILL_SOFT,
	type BrandColor,
	type ChartBar,
	describeArc,
	polarToCartesian,
	safePct,
	TONE_FILL,
	TONE_FILL_SOFT,
} from './shared';
export type { StackedGroup, StackedSegment } from './stacked-bars';
export { StackedBars } from './stacked-bars';
