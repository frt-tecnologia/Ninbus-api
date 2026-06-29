'use client';

import * as React from 'react';
import { signOut } from '@/lib/auth/client';
import { LogOut } from 'lucide-react';
import {
	Avatar,
	AvatarFallback,
} from '@/components/ui/avatar';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * User menu — avatar (initials) + dropdown with the operator's email and a
 * sign-out action. The sign-out POSTs through the same-origin proxy.
 */
export function UserMenu({ email }: { email: string }) {
	const initials = (email || '?')
		.split('@')[0]
		.slice(0, 2)
		.toUpperCase();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger className="rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring">
				<Avatar className="h-8 w-8 border border-border">
					<AvatarFallback className="bg-secondary text-xs font-semibold">
						{initials}
					</AvatarFallback>
				</Avatar>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-56">
				<DropdownMenuLabel className="font-normal">
					<div className="flex flex-col">
						<span className="text-xs text-muted-foreground">Operador</span>
						<span className="truncate font-mono text-xs text-foreground">
							{email}
						</span>
					</div>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					className="text-signal-fault focus:text-signal-fault"
					onClick={() => signOut()}
				>
					<LogOut className="h-4 w-4" />
					Sair
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
