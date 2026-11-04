'use client';
/**
 * ArcShell — the reference's application frame, on real routes and data.
 *
 * Fixed 232px sidebar (brand, workspace, ⌘K search, nav, profile) + topbar
 * (breadcrumb, snapshot, theme toggle). Mobile: nav lives in a bottom sheet.
 * The ⌘K command palette indexes REAL entities (companies, devices, users,
 * invites, groups, releases, deployments) from the existing services.
 */
import {
	Activity,
	ArrowLeft,
	Building2,
	ChevronRight,
	Cpu,
	LayoutDashboard,
	LogOut,
	Menu,
	Radio,
	Search,
	Users,
} from 'lucide-react';
import Image from 'next/image';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import * as React from 'react';
import { Button } from '@/components/arc/button/button';
import { CommandPalette } from '@/components/arc/command-palette/command-palette';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { IconMorph } from '@/components/arc/icon-morph/icon-morph';
import { Tooltip } from '@/components/arc/tooltip/tooltip';
import { COMPANY_SECTIONS, type CompanySectionId } from '@/components/arc-app/company-tabs';
import { LiveBadge } from '@/components/arc-app/live-badge';
import { useAllDeployments } from '@/hooks/use-all-deployments';
import { useFetch } from '@/hooks/useFetch';
import {
	companyService,
	designationService,
	deviceService,
	firmwareService,
	userService,
} from '@/lib/api';
import { categoryService } from '@/lib/api/categories';
import { qk } from '@/lib/cache/keys';
import { useQuery } from '@/lib/cache/use-query';
import { usePwaInstall } from '@/lib/pwa/use-pwa-install';
import s from './app.module.css';
import { roleLabel, Surface, stamp } from './primitives';

const nav = [
	{ path: '/overview', label: 'Visão geral', icon: LayoutDashboard },
	{ path: '/companies', label: 'Empresas', icon: Building2 },
	{ path: '/devices', label: 'Dispositivos', icon: Cpu },
	{ path: '/deployments', label: 'Deployments', icon: Radio },
	{ path: '/users', label: 'Usuários', icon: Users },
	{ path: '/audit', label: 'Atividade', icon: Activity },
];

const descriptions: Record<string, string> = {
	overview: 'Saúde da frota e atualizações que precisam de atenção.',
	companies: 'Organização, membros, dispositivos e diretrizes de cada empresa.',
	devices: 'Cadastro, conectividade e vínculos com empresas e grupos.',
	deployments: 'Acompanhe atualizações e investigue o resultado por dispositivo.',
	firmware: 'Arquivos, versões e releases disponíveis para distribuição.',
	users: 'Pessoas, papéis e convites organizados por empresa.',
	groups: 'Organize equipamentos por linha, garagem ou região.',
	audit: 'Rastreabilidade de alterações com data, hora e contexto.',
};

export function navDescription(path: string) {
	return descriptions[path];
}

export function navLabel(path: string) {
	return nav.find((n) => n.path === path)?.label ?? null;
}

// ── Command palette index (real entities) ──────────────────────────────

function useSearchIndex() {
	const router = useRouter();
	const companies = useFetch(
		React.useCallback(() => companyService.list(), []),
		[],
	);
	const devices = useFetch(
		React.useCallback(() => deviceService.listAll(), []),
		[],
	);
	const users = useFetch(
		React.useCallback(() => userService.list(), []),
		[],
	);
	const invites = useFetch(
		React.useCallback(() => designationService.listPending(), []),
		[],
	);
	const releases = useFetch(
		React.useCallback(() => firmwareService.list(), []),
		[],
	);
	const { deployments } = useAllDeployments(companies.data?.data ?? []);

	const companyList = companies.data?.data ?? [];
	const groups = useFetch(
		React.useCallback(
			() =>
				Promise.all(
					companyList.map((c) =>
						categoryService
							.listByCompany(c.id)
							.then((r) => r.data.map((g) => ({ ...g, companyName: c.name })))
							.catch(() => []),
					),
				).then((all) => ({ data: all.flat(), total: all.flat().length })),
			[companyList.map],
		),
		[companyList.map((c) => c.id).join(',')],
		false,
	);

	const items = React.useMemo(
		() => [
			...nav.map((n) => ({ id: `nav:${n.path}`, label: n.label, group: 'Navegação' })),
			...companyList.map((c) => ({
				id: `company:${c.id}`,
				label: c.name,
				description: `${c.deviceCount} dispositivos · ${c.memberCount} membros`,
				group: 'Empresas',
			})),
			...(devices.data?.data ?? []).map((d) => ({
				id: `device:${d.id}`,
				label: d.name,
				description: d.serialDisplay ?? d.serialNumber ?? '',
				keywords: [
					d.firmwareVersion ?? '',
					companyList.find((c) => c.id === d.companyId)?.name ?? 'Sem empresa',
				],
				group: 'Dispositivos',
			})),
			...(users.data?.data ?? []).map((u) => ({
				id: `user:${u.id}`,
				label: u.name || u.email,
				description: u.email,
				group: 'Pessoas',
			})),
			...(invites.data?.data ?? []).map((i) => ({
				id: `invite:${i.id}`,
				label: i.email,
				description: `${roleLabel(i.role)} · ${i.companyName}`,
				group: 'Convites',
			})),
			...(groups.data?.data ?? []).map((g) => ({
				id: `group:${g.id}`,
				label: g.name,
				description: `${g.type} · ${g.companyName}`,
				group: 'Grupos',
			})),
			...(releases.data?.data ?? []).map((r) => ({
				id: `release:${r.id}`,
				label: `${r.name} · ${r.version}`,
				description: r.artifactType,
				group: 'Firmware e NFX',
			})),
			...deployments.map((r) => ({
				id: `atualização:${r.companyId}:${r.id}`,
				label: r.displayName ?? r.name,
				description: r.artifactVersion ? `v${r.artifactVersion}` : undefined,
				group: 'Deployments',
			})),
		],
		[companyList, devices.data, users.data, invites.data, groups.data, releases.data, deployments],
	);

	function choose(item: { id: string }) {
		const [kind, a, b] = item.id.split(':');
		setSearch(false);
		if (kind === 'nav') router.push(a);
		else if (kind === 'company') router.push(`/companies/${a}`);
		else if (kind === 'device') router.push(`/devices?detail=${a}`);
		else if (kind === 'user') router.push(`/users?detail=${a}`);
		else if (kind === 'invite') router.push(`/users?invite=${a}`);
		else if (kind === 'group') router.push(`/groups?detail=${a}`);
		else if (kind === 'release') router.push(`/deployments?tab=firmware&detail=${a}`);
		else if (kind === 'atualização') router.push(`/deployments/${a}/${b}?detail=${b}`);
	}

	const [search, setSearch] = React.useState(false);
	React.useEffect(() => {
		const handle = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
				e.preventDefault();
				setSearch((v) => !v);
			}
		};
		window.addEventListener('keydown', handle);
		return () => window.removeEventListener('keydown', handle);
	}, []);

	return { items, search, setSearch, choose };
}

// ── PWA install (Arc restyle) ──────────────────────────────────────────

function InstallAppButton() {
	const { canInstall, isStandalone, install } = usePwaInstall();
	const [busy, setBusy] = React.useState(false);
	if (isStandalone || !canInstall) return null;
	return (
		<Button
			variant="ghost"
			loading={busy}
			onClick={async () => {
				setBusy(true);
				try {
					await install();
				} finally {
					setBusy(false);
				}
			}}
		>
			Instalar app
		</Button>
	);
}

// ── Shell ──────────────────────────────────────────────────────────────

export function ArcShell({
	userEmail,
	children,
}: {
	userEmail: string;
	children: React.ReactNode;
}) {
	const router = useRouter();
	const pathname = usePathname();
	const { theme, setTheme } = useTheme();
	const dark = theme === 'dark';
	const [mobile, setMobile] = React.useState(false);
	const [account, setAccount] = React.useState(false);
	const { items, search, setSearch, choose } = useSearchIndex();

	const { deployments } = useAllDeployments([]);
	const active = deployments.filter((d) => ['pending', 'in_progress'].includes(d.status)).length;

	const current =
		nav.find((n) => n.path === pathname) ??
		nav.find((n) => pathname.startsWith(`${n.path}/`)) ??
		null;

	const searchParams = useSearchParams();
	const companyMatch = /^\/companies\/([^/]+)/.exec(pathname);
	const companyContextId = companyMatch?.[1] ?? null;
	const activeSection = (searchParams.get('section') ?? 'devices') as CompanySectionId;
	const companyContext = useQuery(
		companyContextId ? qk.company(companyContextId) : 'company:context:none',
		React.useCallback(
			() => (companyContextId ? companyService.get(companyContextId) : Promise.resolve(null)),
			[companyContextId],
		),
	);
	const companyContextName = (companyContext.data as { name?: string } | null)?.name ?? 'Empresa';

	const companySectionItems = companyContextId ? (
		<nav aria-label={`Seções de ${companyContextName}`}>
			<button
				type="button"
				className={`${s.navItem} ${s.companyBack}`}
				onClick={() => go('/companies')}
			>
				<ArrowLeft size={18} />
				<span>{companyContextName}</span>
			</button>
			{COMPANY_SECTIONS.map((sectionItem) => {
				const selected = sectionItem.id === activeSection;
				return (
					<button
						type="button"
						key={sectionItem.id}
						onClick={() => router.push(`/companies/${companyContextId}?section=${sectionItem.id}`)}
						className={`${s.navItem} ${s.subItem} ${selected ? s.selected : ''}`}
						aria-current={selected ? 'page' : undefined}
					>
						<span>{sectionItem.label}</span>
					</button>
				);
			})}
		</nav>
	) : null;

	function go(path: string) {
		router.push(path);
		setMobile(false);
	}

	const navItems = (
		<nav aria-label="Navegação principal">
			{nav.map(({ path, label, icon: Icon }) => {
				const selected = current?.path === path;
				return (
					<button
						type="button"
						key={path}
						onClick={() => go(path)}
						className={`${s.navItem} ${selected ? s.selected : ''}`}
						aria-current={selected ? 'page' : undefined}
					>
						<Icon size={20} strokeWidth={1.75} />
						<span>{label}</span>
						{path === '/deployments' && active > 0 && <span className={s.navCount}>{active}</span>}
					</button>
				);
			})}
		</nav>
	);

	const initials = (userEmail || '?').split('@')[0].slice(0, 2).toUpperCase();

	const brandSignature = (
		<span className={s.brandSignature}>
			<Image
				src="/console/brand/ninbus-logo.png"
				alt="Ninbus"
				width={120}
				height={56}
				priority
				unoptimized
				className={s.brandNinbus}
			/>
			<span className={s.brandDivider} aria-hidden="true" />
			<Image
				src="/console/brand/frt-logo.png"
				alt="FRT"
				width={44}
				height={44}
				priority
				unoptimized
				className={s.brandFrt}
			/>
		</span>
	);

	return (
		<div className={s.app}>
			<aside className={s.sidebar}>
				<button
					type="button"
					className={s.brandButton}
					onClick={() => go('/overview')}
					aria-label="Ninbus — visão geral"
				>
					{brandSignature}
				</button>
				<div className={s.workspace}>
					<span>Console de administração</span>
					<span className={s.muted}>Super admin</span>
				</div>
				<button type="button" className={s.searchButton} onClick={() => setSearch(true)}>
					<Search size={17} />
					<span>Buscar na plataforma</span>
					<kbd>⌘K</kbd>
				</button>
				{companySectionItems}
				{navItems}
				<div className={s.sidebarBottom}>
					<div className={s.demoNote}>
						<span className={s.dot} />
						Conectado à frota
					</div>
					<button type="button" className={s.profile} onClick={() => setAccount(true)}>
						<span className={s.avatar}>{initials}</span>
						<span>
							{userEmail.split('@')[0]}
							<small>{userEmail}</small>
						</span>
					</button>
				</div>
			</aside>
			<div className={s.content}>
				<header className={s.topbar}>
					<div className={s.breadcrumb}>
						<Button
							variant="ghost"
							className={s.mobileOnly}
							aria-label="Abrir navegação"
							onClick={() => setMobile(true)}
						>
							<Menu size={20} />
						</Button>
						<span>Plataforma</span>
						<ChevronRight size={14} />
						<span>{current?.label ?? 'Ninbus'}</span>
					</div>
					<div className={s.topActions}>
						<InstallAppButton />
						<LiveBadge scope={{ kind: 'global' }} />
						<span role="status" className={s.snapshot}>
							OTA · distribuição
						</span>
						<Tooltip content={dark ? 'Ativar tema claro' : 'Ativar tema escuro'}>
							<Button
								variant="ghost"
								aria-label={dark ? 'Ativar tema claro' : 'Ativar tema escuro'}
								onClick={() => setTheme(dark ? 'light' : 'dark')}
							>
								<IconMorph name="theme" state={dark} size={19} />
							</Button>
						</Tooltip>
					</div>
				</header>
				<main className={s.page}>{children}</main>
			</div>

			<Surface open={mobile} onClose={() => setMobile(false)} title="Navegação">
				{companySectionItems}
				{navItems}
				<Button
					variant="secondary"
					onClick={() => {
						setMobile(false);
						setSearch(true);
					}}
				>
					Buscar na plataforma
				</Button>
			</Surface>

			<Surface
				open={account}
				onClose={() => setAccount(false)}
				title="Conta"
				description={userEmail}
			>
				<div className={s.formStack}>
					<dl className={s.facts}>
						<dt>Operador</dt>
						<dd>{userEmail}</dd>
						<dt>Sessão</dt>
						<dd>{stamp(Date.now())}</dd>
					</dl>
					<Button
						variant="secondary"
						onClick={async () => {
							const { signOut } = await import('@/lib/auth/client');
							try {
								await signOut();
							} catch {
								/* force-clear below */
							}
							window.location.href = `/console/auth/login?t=${Date.now()}`;
						}}
					>
						<LogOut size={17} />
						Sair da conta
					</Button>
				</div>
			</Surface>

			<Dialog open={search} onOpenChange={setSearch}>
				<DialogContent
					title="Buscar na plataforma"
					description="Pessoas, empresas, dispositivos, grupos, firmware, NFX, convites e deployments."
				>
					<CommandPalette
						items={items}
						label="Busca universal"
						placeholder="Busque nome, serial, versão, e-mail..."
						onSelect={choose}
						onClose={() => setSearch(false)}
					/>
				</DialogContent>
			</Dialog>
		</div>
	);
}
