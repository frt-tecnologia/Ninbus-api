import { Skeleton } from '@/components/arc/skeleton/skeleton';
import s from '@/components/arc-app/app.module.css';

/**
 * Admin route-segment loading UI — Arc skeletons mirroring the page layout
 * (metric row + content panel) so navigation feels immediate.
 */
export default function AdminLoading() {
	return (
		<div aria-busy="true" className={s.loading}>
			<Skeleton lines={6} label="Carregando registros" />
			<Skeleton lines={6} label="Carregando conteúdo" />
		</div>
	);
}
