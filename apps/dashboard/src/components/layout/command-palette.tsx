'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
	LayoutDashboard,
	HardDrive,
	Building2,
	Users,
	Package,
	FileText,
} from 'lucide-react';
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandShortcut,
} from '@/components/ui/command';
import { ROUTES, type RouteKey } from '@/lib/routes';
import type { LucideIcon } from 'lucide-react';

/**
 * ⌘K command palette — the power-operator entry point. Jumps to any page by
 * name. Triggered globally from <Topbar> / <AppShell> via the `open` prop.
 * Device-by-serial search is added in the devices feature (Fase 5).
 */
export function CommandPalette({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (v: boolean) => void;
}) {
	const router = useRouter();
	const go = (key: RouteKey) => {
		onOpenChange(false);
		router.push(ROUTES[key]);
	};

	return (
		<CommandDialog open={open} onOpenChange={onOpenChange}>
			<CommandInput placeholder="Ir para… (ex.: dispositivos, empresas)" />
			<CommandList>
				<CommandEmpty>Nada encontrado.</CommandEmpty>
				<CommandGroup heading="Navegação">
					<Item
						icon={LayoutDashboard}
						label="Visão geral"
						shortcut="G O"
						onSelect={() => go('overview')}
					/>
					<Item
						icon={HardDrive}
						label="Dispositivos"
						shortcut="G D"
						onSelect={() => go('devices')}
					/>
					<Item
						icon={Building2}
						label="Empresas"
						shortcut="G C"
						onSelect={() => go('companies')}
					/>
					<Item
						icon={Users}
						label="Usuários"
						shortcut="G U"
						onSelect={() => go('users')}
					/>
					<Item
						icon={Package}
						label="Deployments"
						shortcut="G P"
						onSelect={() => go('deployments')}
					/>
					<Item
						icon={FileText}
						label="Designações"
						shortcut="G N"
						onSelect={() => go('designations')}
					/>
				</CommandGroup>
			</CommandList>
		</CommandDialog>
	);
}

function Item({
	icon: Icon,
	label,
	shortcut,
	onSelect,
}: {
	icon: LucideIcon;
	label: string;
	shortcut?: string;
	onSelect: () => void;
}) {
	return (
		<CommandItem onSelect={onSelect}>
			<Icon className="h-4 w-4" />
			<span>{label}</span>
			{shortcut && <CommandShortcut>{shortcut}</CommandShortcut>}
		</CommandItem>
	);
}
