import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * <Brand> — the "Logo Ninbus | FRT" lockup.
 *
 * Always shows the Ninbus logo, a thin divider, and the FRT logo side by
 * side. This ties the dashboard to the FRT Tecnologia parent identity, the
 * same association used in Ninbus emails and marketing.
 *
 * Logos are self-hosted in /public (downloaded once; no runtime dependency on
 * CloudFront/Wix availability). `next/image` optimizes + caches them.
 *
 * Variants:
 *   - default: compact rail/header lockup (logos + wordmark sized for ~h-8).
 *   - stacked: larger, centered logo used on the auth (login) screen.
 */
export function Brand({
	variant = 'default',
	className,
}: {
	variant?: 'default' | 'stacked';
	className?: string;
}) {
	if (variant === 'stacked') {
		return (
			<div className={cn('flex flex-col items-center gap-5', className)}>
				<Image
					src="/ninbus-logo.png"
					alt="Ninbus"
					width={84}
					height={84}
					priority
					className="h-20 w-20 object-contain"
				/>
				<BrandLockup />
			</div>
		);
	}

	return (
		<div className={cn('flex items-center gap-2.5', className)}>
			<Image
				src="/ninbus-logo.png"
				alt="Ninbus"
				width={28}
				height={28}
				className="h-7 w-7 shrink-0 object-contain"
			/>
			<BrandLockup />
		</div>
	);
}

/** The "Ninbus | FRT" wordmark row. */
function BrandLockup({ className }: { className?: string }) {
	return (
		<div className={cn('flex items-center gap-2.5 leading-none', className)}>
			<span className="text-sm font-semibold tracking-tight text-foreground">
				Ninbus
			</span>
			<span aria-hidden className="text-muted-foreground/40">
				|
			</span>
			<Image
				src="/frt-logo.png"
				alt="FRT Tecnologia"
				width={22}
				height={22}
				className="h-[22px] w-[22px] shrink-0 object-contain opacity-80"
			/>
		</div>
	);
}
