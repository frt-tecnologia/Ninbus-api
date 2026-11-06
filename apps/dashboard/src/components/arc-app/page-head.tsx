'use client';
import Link from 'next/link';
/**
 * PageHead + Guard — the reference's page header and state guard, shared by
 * every admin page. One h1, one primary action, refresh + period in the
 * actions slot.
 */
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/arc/empty-state/empty-state';
import { Skeleton } from '@/components/arc/skeleton/skeleton';
import { invalidateQueries } from '@/lib/cache/query-cache';
import s from './app.module.css';
import { Alert, Button, RefreshButton } from './primitives';

export interface Crumb {
	label: string;
	href?: string;
}

export function PageHead({
	title,
	description,
	actions,
	crumbs,
}: {
	title: string;
	description?: string;
	actions?: ReactNode;
	crumbs?: Crumb[];
}) {
	return (
		<div className={s.pageHead}>
			<div>
				{crumbs && crumbs.length > 0 && (
					<nav aria-label="Trilha de navegação" className={s.crumbs}>
						<ol>
							{crumbs.map((crumb, i) => {
								const last = i === crumbs.length - 1;
								return (
									<li key={`${crumb.label}-${i}`}>
										{crumb.href && !last ? (
											<Link href={crumb.href}>{crumb.label}</Link>
										) : (
											<span aria-current={last ? 'page' : undefined}>{crumb.label}</span>
										)}
									</li>
								);
							})}
						</ol>
					</nav>
				)}
				<h1>{title}</h1>
				{description && <p>{description}</p>}
			</div>
			{actions && (
				<div className={s.actions}>
					<RefreshButton onRefresh={onWindowRefresh} />
					{actions}
				</div>
			)}
		</div>
	);
}

/**
 * Soft refresh — invalidates every cached query so mounted screens
 * revalidate in place (stale-while-revalidate) instead of a full reload.
 */
async function onWindowRefresh() {
	await new Promise((r) => setTimeout(r, 150));
	invalidateQueries(() => true);
}

export function Guard({
	loading,
	error,
	empty,
	emptyTitle = 'Nenhum registro',
	onRetry,
	children,
}: {
	loading?: boolean;
	error?: string | null;
	empty?: boolean;
	emptyTitle?: string;
	onRetry?: () => void;
	children: ReactNode;
}) {
	if (loading)
		return (
			<div aria-busy="true" className={s.loading}>
				<Skeleton lines={6} label="Carregando registros" />
				<Skeleton lines={6} label="Carregando conteúdo" />
			</div>
		);
	if (empty)
		return <EmptyState title={emptyTitle} description="Nada para exibir por aqui ainda." />;
	if (error)
		return (
			<Alert tone="danger" title="Não foi possível concluir a consulta">
				{error}
				{onRetry && (
					<Button variant="secondary" onClick={onRetry}>
						Tentar novamente
					</Button>
				)}
			</Alert>
		);
	return <>{children}</>;
}
