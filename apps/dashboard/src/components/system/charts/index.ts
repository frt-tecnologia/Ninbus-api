/**
 * Chart primitives barrel — pure-SVG/HTML, theme-aware, hover-enabled.
 * No chart library: each primitive reads the SIGNAL token system
 * (lib/design/tokens → globals.css --signal-*) so light/dark share one look.
 *
 * Usage:
 *   import { ActivityChart, StackedBars, Gauge } from '@/components/system/charts'
 */
export { ActivityChart } from './activity-chart';
export { StackedBars } from './stacked-bars';
export type { StackedGroup, StackedSegment } from './stacked-bars';
export { Gauge } from './gauge';
export type { GaugeSegment } from './gauge';
export { DeploymentDonut } from './deployment-donut';
export type { DonutSegment } from './deployment-donut';
export {
	TONE_FILL,
	TONE_FILL_SOFT,
	BRAND_FILL,
	BRAND_FILL_SOFT,
	describeArc,
	polarToCartesian,
	safePct,
	type ChartBar,
	type BrandColor,
} from './shared';
