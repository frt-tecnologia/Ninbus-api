'use client';

import { type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
	LayoutDashboard,
	HardDrive,
	Building2,
	Users,
	Package,
	FileText,
	LogOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV: Array<{ href: string; label: string; icon: typeof LayoutDashboard; exact?: boolean }> = [
	{ href: '/admin/overview', label: 'Visão geral', icon: LayoutDashboard, exact: true },
	{ href: '/admin/devices', label: 'Dispositivos', icon: HardDrive },
	{ href: '/admin/companies', label: 'Empresas', icon: Building2 },
	{ href: '/admin/users', label: 'Usuários', icon: Users },
	{ href: '/admin/deployments', label: 'Deployments', icon: Package },
	{ href: '/admin/designations', label: 'Designações', icon: FileText },
];

export function Sidebar({ userEmail }: { userEmail?: string | null }) {
	const pathname = usePathname();

	return (
		<aside className="flex h-screen w-60 flex-shrink-0 flex-col border-r border-gray-200 bg-white">
			<div className="flex h-16 items-center gap-2 border-b border-gray-100 px-5">
				<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 font-bold text-white">
					N
				</div>
				<span className="font-semibold text-gray-900">Ninbus Admin</span>
			</div>

			<nav className="flex-1 space-y-1 overflow-y-auto p-3">
				{NAV.map((item) => {
					const active = item.exact
						? pathname === item.href
						: pathname.startsWith(item.href);
					const Icon = item.icon;
					return (
						<Link
							key={item.href}
							href={item.href}
							className={cn(
								'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
								active
									? 'bg-brand-50 text-brand-700'
									: 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
							)}
						>
							<Icon className="h-4 w-4" />
							{item.label}
						</Link>
					);
				})}
			</nav>

			<div className="border-t border-gray-100 p-3">
				{userEmail && (
					<div className="mb-2 truncate px-2 text-xs text-gray-500">
						{userEmail}
					</div>
				)}
				<LogoutButton />
			</div>
		</aside>
	);
}

function LogoutButton() {
	return (
		<form action="/admin/api/auth/sign-out" method="POST">
			<button
				type="submit"
				className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900"
			>
				<LogOut className="h-4 w-4" />
				Sair
			</button>
		</form>
	);
}
