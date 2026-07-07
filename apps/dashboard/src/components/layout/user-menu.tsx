'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
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
import { ROUTES } from '@/lib/routes';

/**
 * User menu — avatar (initials) + dropdown with the operator's email and a
 * sign-out action.
 *
 * LOGOUT correctness: the sign-out MUST be awaited (the API invalidates the
 * session server-side), then we hard-navigate to /auth/login with a cache-bust
 * query. `router.refresh()` re-runs server components so the admin layout's
 * requireAdmin() re-evaluates against the (now empty) session — no stale
 * "Sua conta não tem permissão" from a cached cookie.
 */
export function UserMenu({ email }: { email: string }) {
	const router = useRouter();
	const [signingOut, setSigningOut] = React.useState(false);

	const initials = (email || '?')
		.split('@')[0]
		.slice(0, 2)
		.toUpperCase();

	async function handleSignOut() {
		setSigningOut(true);
		try {
			// 1. Await the API sign-out (clears the session cookie server-side).
			await signOut();
		} catch {
			// Even if the network call fails, force-clear client state + redirect.
		}
		// 2. Revalidate server components (drops cached session data).
		router.refresh();
		// 3. Hard redirect to login (no history back into the dashboard).
		//    The query busts any cached login page so a fresh session starts.
		router.replace(`${ROUTES.login}?t=${Date.now()}`);
	}

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
					disabled={signingOut}
					onClick={handleSignOut}
				>
					<LogOut className="h-4 w-4" />
					{signingOut ? 'Saindo…' : 'Sair'}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
