'use client';

import { companyService, deviceService, userService } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import { cn } from '@/lib/utils';
import type { Company, Device, User } from '@/types/domain';
import {
	Building2,
	Bus,
	HardDrive,
	LayoutDashboard,
	type LucideIcon,
	Package,
	Search,
	Users,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

/**
 * <UniversalSearch> — the global topbar search that occupies all available
 * width and searches across EVERYTHING (companies, users, devices, plus page
 * navigation). One search → one click → straight to the target.
 *
 * EFFICIENCY: the three entity lists are fetched ONCE on mount (companies and
 * users are small — tens of rows; devices via the admin list). Search itself is
 * 100% client-side over the in-memory index → instant, zero requests per
 * keystroke. Results are capped (5 per group) to keep the DOM light.
 *
 * A small TTL (60s) re-fetches stale data so newly-created entities appear
 * without a full reload.
 */

interface SearchEntry {
	id: string;
	label: string;
	sublabel: string;
	icon: LucideIcon;
	href: string;
	group: string;
}

const NAV_ENTRIES: SearchEntry[] = [
	{
		id: 'nav-overview',
		label: 'Visão geral',
		sublabel: 'Dashboard de observabilidade',
		icon: LayoutDashboard,
		href: ROUTES.overview,
		group: 'Navegação',
	},
	{
		id: 'nav-devices',
		label: 'Dispositivos',
		sublabel: 'Frota OTA',
		icon: HardDrive,
		href: ROUTES.devices,
		group: 'Navegação',
	},
	{
		id: 'nav-companies',
		label: 'Empresas',
		sublabel: 'Tenants',
		icon: Building2,
		href: ROUTES.companies,
		group: 'Navegação',
	},
	{
		id: 'nav-users',
		label: 'Usuários',
		sublabel: 'Contas e convites',
		icon: Users,
		href: ROUTES.users,
		group: 'Navegação',
	},
	{
		id: 'nav-deployments',
		label: 'Deployments',
		sublabel: 'Atualizações OTA',
		icon: Package,
		href: ROUTES.deployments,
		group: 'Navegação',
	},
];

const TTL_MS = 60_000;

export function UniversalSearch() {
	const router = useRouter();
	const [query, setQuery] = React.useState('');
	const [open, setOpen] = React.useState(false);
	const [activeIndex, setActiveIndex] = React.useState(0);

	// In-memory index — fetched once, refreshed every TTL.
	const [entries, setEntries] = React.useState<SearchEntry[]>(NAV_ENTRIES);
	const [loaded, setLoaded] = React.useState(false);
	const lastLoad = React.useRef(0);

	const buildIndex = React.useCallback(async () => {
		try {
			const [companies, users, devices] = await Promise.all([
				companyService
					.list()
					.then((r) => r.data)
					.catch(() => []),
				userService
					.list()
					.then((r) => r.data)
					.catch(() => []),
				deviceService
					.listAll()
					.then((r) => r.data)
					.catch(() => []),
			]);

			const companyEntries: SearchEntry[] = (companies as Company[]).map((c) => ({
				id: `co-${c.id}`,
				label: c.name,
				sublabel: `Empresa · ${c.deviceCount} disp. · ${c.memberCount} membros`,
				icon: Building2,
				href: `${ROUTES.companies}/${c.id}`,
				group: 'Empresas',
			}));
			const userEntries: SearchEntry[] = (users as User[]).map((u) => ({
				id: `us-${u.id}`,
				label: u.name || u.email,
				sublabel: `Usuário · ${u.email}${u.isSuperAdmin ? ' · super admin' : ''}`,
				icon: Users,
				href: ROUTES.users,
				group: 'Usuários',
			}));
			const deviceEntries: SearchEntry[] = (devices as Device[]).map((d) => ({
				id: `dv-${d.id}`,
				label: d.name,
				sublabel: `Dispositivo · ${d.serialDisplay ?? d.serialNumber ?? d.hawkbitTargetId ?? '—'}`,
				icon: HardDrive,
				href: ROUTES.devices,
				group: 'Dispositivos',
			}));

			setEntries([...NAV_ENTRIES, ...companyEntries, ...userEntries, ...deviceEntries]);
			lastLoad.current = Date.now();
			setLoaded(true);
		} catch {
			/* tolerated — keep nav-only index */
		}
	}, []);

	// Load on first focus; refresh if stale.
	const ensureLoaded = React.useCallback(() => {
		if (!loaded || Date.now() - lastLoad.current > TTL_MS) {
			void buildIndex();
		}
	}, [loaded, buildIndex]);

	// Filter client-side (instant). Cap results per group for a light DOM.
	const results = React.useMemo(() => {
		const term = query.trim().toLowerCase();
		if (!term) return NAV_ENTRIES;
		return entries.filter(
			(e) => e.label.toLowerCase().includes(term) || e.sublabel.toLowerCase().includes(term),
		);
	}, [entries, query]);

	// Group + cap (max 6 per group).
	const grouped = React.useMemo(() => {
		const map = new Map<string, SearchEntry[]>();
		for (const e of results) {
			const arr = map.get(e.group) ?? [];
			if (arr.length < 6) arr.push(e);
			map.set(e.group, arr);
		}
		return [...map.entries()];
	}, [results]);

	const flat = React.useMemo(() => grouped.flatMap(([, items]) => items), [grouped]);

	// Reset active index when query changes.
	React.useEffect(() => {
		setActiveIndex(0);
	}, [query]);

	const onSelect = (e: SearchEntry) => {
		setQuery('');
		setOpen(false);
		router.push(e.href);
	};

	// Keyboard nav within the dropdown.
	const onKeyDown = (ev: React.KeyboardEvent) => {
		if (ev.key === 'ArrowDown') {
			ev.preventDefault();
			setOpen(true);
			setActiveIndex((i) => Math.min(i + 1, flat.length - 1));
		} else if (ev.key === 'ArrowUp') {
			ev.preventDefault();
			setActiveIndex((i) => Math.max(i - 1, 0));
		} else if (ev.key === 'Enter' && flat[activeIndex]) {
			ev.preventDefault();
			onSelect(flat[activeIndex]);
		} else if (ev.key === 'Escape') {
			setOpen(false);
		}
	};

	// Close on outside click.
	const containerRef = React.useRef<HTMLDivElement>(null);
	const inputRef = React.useRef<HTMLInputElement>(null);

	// ⌘K focuses this search (triggered from <AppShell>).
	React.useEffect(() => {
		const onFocus = () => {
			inputRef.current?.focus();
			inputRef.current?.select();
			setOpen(true);
			ensureLoaded();
		};
		window.addEventListener('focus-universal-search', onFocus);
		return () => window.removeEventListener('focus-universal-search', onFocus);
	}, [ensureLoaded]);

	React.useEffect(() => {
		if (!open) return;
		const onDoc = (e: MouseEvent) => {
			if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		window.addEventListener('mousedown', onDoc);
		return () => window.removeEventListener('mousedown', onDoc);
	}, [open]);

	return (
		<div ref={containerRef} className="relative min-w-0 flex-1">
			<div className="relative">
				<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
				<input
					ref={inputRef}
					type="text"
					value={query}
					onChange={(e) => {
						setQuery(e.target.value);
						setOpen(true);
						ensureLoaded();
					}}
					onFocus={() => {
						setOpen(true);
						ensureLoaded();
					}}
					onKeyDown={onKeyDown}
					placeholder="Buscar em tudo: empresas, usuários, dispositivos…"
					aria-label="Busca universal"
					className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-16 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				/>
				<kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.6rem] sm:inline-block">
					⌘K
				</kbd>
			</div>

			{open && (
				<div className="absolute left-0 right-0 top-full z-[100] mt-1 max-h-[70vh] overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
					{flat.length === 0 ? (
						<p className="px-3 py-6 text-center text-sm text-muted-foreground">
							Nenhum resultado para “{query}”.
						</p>
					) : (
						grouped.map(([group, items]) => (
							<div key={group} className="py-1">
								<div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
									{group}
								</div>
								{items.map((e) => {
									const idx = flat.indexOf(e);
									const active = idx === activeIndex;
									const Icon = e.icon;
									return (
										<button
											key={e.id}
											type="button"
											onClick={() => onSelect(e)}
											onMouseEnter={() => setActiveIndex(idx)}
											className={cn(
												'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors',
												active ? 'bg-secondary' : 'hover:bg-secondary/60',
											)}
										>
											<Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
											<div className="min-w-0 flex-1">
												<div className="truncate text-sm text-foreground">{e.label}</div>
												<div className="truncate text-[11px] text-muted-foreground">
													{e.sublabel}
												</div>
											</div>
										</button>
									);
								})}
							</div>
						))
					)}
				</div>
			)}
		</div>
	);
}

void Bus; // reserved icon
