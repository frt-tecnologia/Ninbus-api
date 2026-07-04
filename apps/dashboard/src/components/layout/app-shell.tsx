'use client';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { registerServiceWorker } from '@/lib/pwa/use-pwa-install';
import { Menu } from 'lucide-react';
import * as React from 'react';
import { Brand } from './brand';
import { InstallAppButton } from './install-app-button';
import { SidebarNav } from './sidebar-nav';
import { ThemeToggle } from './theme-toggle';
import { UniversalSearch } from './universal-search';
import { UserMenu } from './user-menu';

/**
 * <AppShell> — the application frame. Responsive by design:
 *  - ≥ md: fixed left rail (w-56) + sticky topbar + scrollable content.
 *  - <  md: the rail collapses into a slide-over <Sheet>; the topbar gains a
 *    hamburger trigger. NO horizontal table scroll — pages handle their own
 *    mobile card layout.
 *
 * The ⌘K command palette is global: registered here, opened from the topbar
 * search button or the Cmd/Ctrl+K shortcut.
 */
export function AppShell({
	userEmail,
	children,
}: {
	userEmail: string;
	children: React.ReactNode;
}) {
	const [navOpen, setNavOpen] = React.useState(false);

	// Global ⌘K / Ctrl+K — focus the universal search bar.
	React.useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
				e.preventDefault();
				window.dispatchEvent(new CustomEvent('focus-universal-search'));
			}
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, []);

	// Register the PWA service worker (production only — see registerServiceWorker).
	React.useEffect(() => {
		registerServiceWorker('/console');
	}, []);

	const NavBody = (
		<>
			<div className="flex h-14 items-center px-3">
				<Brand />
			</div>
			<div className="mt-2 px-2">
				<SidebarNav onNavigate={() => setNavOpen(false)} />
			</div>
		</>
	);

	return (
		<div className="relative z-10 flex min-h-screen">
			{/* Desktop rail */}
			<aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-border bg-card/50 md:flex">
				{NavBody}
			</aside>

			{/* Mobile slide-over */}
			<Sheet open={navOpen} onOpenChange={setNavOpen}>
				<div className="flex min-w-0 flex-1 flex-col">
					<header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur md:px-6">
						<SheetTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="md:hidden"
								aria-label="Abrir navegação"
							>
								<Menu className="h-5 w-5" />
							</Button>
						</SheetTrigger>
						<UniversalSearch />
						<InstallAppButton />
						<ThemeToggle />
						<UserMenu email={userEmail} />
					</header>

					<main className="mx-auto w-full max-w-[1400px] flex-1 px-3 py-6 md:px-8">{children}</main>
				</div>
				<SheetContent side="left" className="w-64 p-0">
					<SheetTitle className="sr-only">Navegação</SheetTitle>
					{NavBody}
				</SheetContent>
			</Sheet>
		</div>
	);
}
