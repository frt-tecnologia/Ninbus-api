'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
	LayoutDashboard,
	HardDrive,
	Building2,
	Users,
	Package,
	FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Primary navigation. Routes are written WITHOUT the basePath prefix —
 * next/link auto-applies basePath '/admin' — and usePathname() returns the
 * basePath-stripped path, so matching works both ways.
 */
const NAV: Array<{
	href: string;
	label: string;
	icon: React.ComponentType<{ className?: string }>;
	exact?: boolean;
	badge?: string;
}> = [
	{ href: '/overview', label: 'Visão geral', icon: LayoutDashboard, exact: true },
	{ href: '/devices', label: 'Dispositivos', icon: HardDrive, badge: 'frota' },
	{ href: '/companies', label: 'Empresas', icon: Building2 },
	{ href: '/users', label: 'Usuários', icon: Users },
	{ href: '/deployments', label: 'Deployments', icon: Package },
	{ href: '/designations', label: 'Designações', icon: FileText },
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
				const active = item.exact
					? pathname === item.href
					: pathname.startsWith(item.href);
				const Icon = item.icon;
				return (
					<Link
						key={item.href}
						href={item.href}
						onClick={onNavigate}
						aria-current={active ? 'page' : undefined}
						className={cn(
							'group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
							active
								? 'bg-secondary text-secondary-foreground'
								: 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
						)}
					>
						<Icon className="h-4 w-4 shrink-0" />
						<span className="flex-1">{item.label}</span>
						{active && (
							<span className="h-1 w-1 rounded-full bg-primary" aria-hidden />
						)}
					</Link>
				);
			})}
		</nav>
	);
}
