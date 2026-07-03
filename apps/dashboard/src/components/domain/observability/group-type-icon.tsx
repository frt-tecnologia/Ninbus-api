import { cn } from '@/lib/utils';

/**
 * <GroupTypeIcon> — domain-native icon for a device group type.
 *
 * Replaces emoji (🏭🚌🗺️) with small SVG glyphs that match the "Fleet Control
 * Surface" telemetry aesthetic. Anti-generic: no emoji, line-art geometry.
 * `type` maps the category_type enum (garage/bus_line/region/yard/custom).
 */

export type GroupType = 'garage' | 'bus_line' | 'region' | 'yard' | 'custom' | string;

export const GROUP_TYPE_LABELS: Record<string, string> = {
	garage: 'Garagem',
	bus_line: 'Linha de ônibus',
	region: 'Região',
	yard: 'Pátio',
	custom: 'Personalizado',
};

export function GroupTypeIcon({
	type,
	className,
}: {
	type: GroupType;
	className?: string;
}) {
	const common = {
		className: cn('h-3.5 w-3.5', className),
		viewBox: '0 0 24 24',
		fill: 'none',
		stroke: 'currentColor',
		strokeWidth: 1.75,
		strokeLinecap: 'round' as const,
		strokeLinejoin: 'round' as const,
		'aria-hidden': true,
	};

	switch (type) {
		case 'garage':
			// building / warehouse
			return (
				<svg {...common}>
					<path d="M3 21V8l9-5 9 5v13" />
					<path d="M7 21v-7h10v7" />
					<path d="M7 14h10" />
				</svg>
			);
		case 'bus_line':
			// bus
			return (
				<svg {...common}>
					<rect x="4" y="4" width="16" height="14" rx="2" />
					<path d="M4 11h16" />
					<circle cx="8" cy="20" r="1.5" />
					<circle cx="16" cy="20" r="1.5" />
				</svg>
			);
		case 'region':
			// map pin / region
			return (
				<svg {...common}>
					<path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z" />
					<circle cx="12" cy="9" r="2.5" />
				</svg>
			);
		case 'yard':
			// grid / lot
			return (
				<svg {...common}>
					<rect x="3" y="3" width="18" height="18" rx="1" />
					<path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
				</svg>
			);
		default:
			// custom — layers/folder
			return (
				<svg {...common}>
					<path d="M3 7l9-4 9 4-9 4-9-4z" />
					<path d="M3 12l9 4 9-4M3 17l9 4 9-4" />
				</svg>
			);
	}
}
