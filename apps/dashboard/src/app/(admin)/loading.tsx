import { PageHeader } from '@/components/layout/page-header';
import { Section } from '@/components/system';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Admin route-segment loading UI.
 *
 * Next.js App Router shows this INSTANTLY during a route transition (streaming
 * / Suspense) while the next page's data resolves — so navigation feels
 * immediate instead of "frozen". This is the App Router's native, performant
 * equivalent of a route-transition loader: no client router lib needed.
 */
export default function AdminLoading() {
	return (
		<>
			<PageHeader
				title={<Skeleton className="h-6 w-48" />}
				description={<Skeleton className="mt-2 h-4 w-72" />}
			/>
			<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
				{Array.from({ length: 4 }).map((_, i) => (
					<Section key={i}>
						<Skeleton className="h-3 w-20" />
						<Skeleton className="mt-3 h-8 w-16" />
					</Section>
				))}
			</div>
			<Section className="mt-4">
				<Skeleton className="h-4 w-32" />
				<div className="mt-4 flex flex-col gap-2">
					{Array.from({ length: 6 }).map((_, i) => (
						<Skeleton key={i} className="h-8 w-full" />
					))}
				</div>
			</Section>
		</>
	);
}
