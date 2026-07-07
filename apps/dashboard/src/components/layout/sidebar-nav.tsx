'use client';

import { ROUTES } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { Building2, HardDrive, LayoutDashboard, Package, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type * as React from 'react';

/**
 * Primary navigation. Routes come from the typed route map (lib/routes.ts) so
 * navigation is refactor-safe. Links use next/link, which:
 *   • auto-applies basePath '/console' (paths here are prefix-stripped),
 *   • performs instant CLIENT-SIDE navigation (no full page reload),
 *   • PREFETCHES the route on hover/focus → the next page's JS+data is ready
 *     before the click lands. This is the App Router's native performant
 *     navigation; no external router is needed.
 * usePathname() returns the basePath-stripped path, so matching works directly.
 */
type NavItem = {
	key: keyof typeof ROUTES;
	label: string;
	icon: React.ComponentType<{ className?: string }>;
	exact?: boolean;
};

const NAV: NavItem[] = [
	{ key: 'overview', label: 'Visão geral', icon: LayoutDashboard, exact: true },
	{ key: 'companies', label: 'Empresas', icon: Building2 },
	{ key: 'devices', label: 'Dispositivos', icon: HardDrive },
	{ key: 'users', label: 'Usuários', icon: Users },
	{ key: 'deployments', label: 'Deployments', icon: Package },
];

export function SidebarNav({
	onNavigate,
	className,
}: {
	onNavigate?: () => void;
	className?: string;
}) {
	const pathname = usePathname();
	return (
		<nav className={cn('flex flex-col gap-0.5', className)} aria-label="Navegação">
			{NAV.map((item) => {
				const href = ROUTES[item.key];
				const active = item.exact ? pathname === href : pathname.startsWith(href);
				const Icon = item.icon;
				return (
					<Link
						key={item.key}
						href={href}
						onClick={onNavigate}
						// Prefetch the route eagerly — these are the primary nav targets,
						// so keeping them warm makes transitions feel instant.
						prefetch
						aria-current={active ? 'page' : undefined}
						className={cn(
							'group flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm transition-colors',
							active
								? 'bg-secondary text-secondary-foreground'
								: 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
						)}
					>
						<Icon className="h-[1.05rem] w-[1.05rem] shrink-0" />
						<span className="flex-1">{item.label}</span>
						{active && <span className="h-1 w-1 rounded-full bg-primary" aria-hidden />}
					</Link>
				);
			})}
		</nav>
	);
}
