'use client';

import { Empty, Id, SearchField } from '@/components/system';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { useFetch } from '@/hooks/useFetch';
import type { CompanyRole, Member } from '@/lib/api';
import { memberService, userService } from '@/lib/api';
import { notifyDataChanged } from '@/lib/data-events';
import { ROUTES } from '@/lib/routes';
import type { Company } from '@/types/domain';
import type { User } from '@/types/domain';
import { ExternalLink, Trash2, UserPlus, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { useCallback } from 'react';
import { toast } from 'sonner';
const ROLES: { value: CompanyRole; label: string }[] = [
	{ value: 'owner', label: 'Proprietário' },
	{ value: 'admin', label: 'Administrador' },
	{ value: 'operator', label: 'Operador' },
	{ value: 'viewer', label: 'Visualizador' },
];

/**
 * Members body — the content of <MembersManager>. Two regions:
 *
 *  1. Add member: a searchable combobox over ALL platform users (name/email),
 *     a role select, and an "Adicionar" button. When the typed name/email
 *     matches no existing user, a text-link offers to add a new one on the
 *     Users page (where the full invite flow lives).
 *  2. Current members: list with role select + remove, matching the dashboard
 *     density/signal aesthetic (no broken Field/label pattern).
 *
 * All mutations go through the API (memberService) and refresh via the data bus.
 */
export function MembersBody({ companyId }: { companyId: string }) {
	const router = useRouter();
	const members = useFetch(useCallback(() => memberService.list(companyId), [companyId]));
	const platformUsers = useFetch(useCallback(() => userService.list(), []));

	// Combobox state
	const [query, setQuery] = React.useState('');
	const [selectedUserId, setSelectedUserId] = React.useState<string>('');
	const [role, setRole] = React.useState<CompanyRole>('viewer');
	const [adding, setAdding] = React.useState(false);

	// Existing member user-ids (to show "já é membro" badge).
	const memberUserIds = React.useMemo(
		() => new Set((members.data?.data ?? []).map((m) => m.userId)),
		[members.data],
	);

	// Filter platform users by the typed query (name OR email).
	const matchingUsers = React.useMemo(() => {
		const term = query.trim().toLowerCase();
		const all = platformUsers.data?.data ?? [];
		if (!term) return all.slice(0, 8); // show a few when empty
		return all
			.filter((u) => u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term))
			.slice(0, 8);
	}, [platformUsers.data, query]);

	// Whether the query looks like an email/name that matches nobody.
	const noMatch = React.useMemo(() => {
		const term = query.trim().toLowerCase();
		if (!term) return false;
		const all = platformUsers.data?.data ?? [];
		return !all.some(
			(u) => u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term),
		);
	}, [query, platformUsers.data]);

	const selectedUser = React.useMemo(
		() => (platformUsers.data?.data ?? []).find((u) => u.id === selectedUserId) ?? null,
		[platformUsers.data, selectedUserId],
	);

	async function add(e: React.FormEvent) {
		e.preventDefault();
		if (!selectedUser) return;
		setAdding(true);
		const err = await memberService
			.add(companyId, { email: selectedUser.email, role })
			.then(() => null)
			.catch((e: unknown) => (e instanceof Error ? e.message : 'Falha'));
		setAdding(false);
		if (err) return toast.error(err);
		toast.success('Membro adicionado.');
		setQuery('');
		setSelectedUserId('');
		notifyDataChanged();
		members.refetch();
	}

	async function changeRole(m: Member, next: CompanyRole) {
		const err = await memberService
			.updateRole(companyId, m.userId, { role: next })
			.then(() => null)
			.catch((e: unknown) => (e instanceof Error ? e.message : 'Falha'));
		if (err) return toast.error(err);
		toast.success('Função atualizada.');
		notifyDataChanged();
		members.refetch();
	}

	async function remove(m: Member) {
		const err = await memberService
			.remove(companyId, m.userId)
			.then(() => null)
			.catch((e: unknown) => (e instanceof Error ? e.message : 'Falha'));
		if (err) return toast.error(err);
		toast.success('Membro removido.');
		notifyDataChanged();
		members.refetch();
	}

	return (
		<div className="mt-4 flex flex-col gap-4">
			{/* ── Add member ── */}
			<form onSubmit={add} className="space-y-2">
				<span className="text-xs font-medium text-foreground">Adicionar membro</span>
				<div className="relative">
					<SearchField
						value={query}
						onChange={setQuery}
						placeholder="Pesquisar usuário por nome ou email…"
						autoFocus
					/>
					{/* Dropdown of matching platform users */}
					{query && (
						<div className="absolute left-0 right-0 top-full z-[100] mt-1 rounded-md border border-border bg-popover shadow-lg">
							<ScrollArea className="max-h-56">
								{matchingUsers.length === 0 ? (
									<p className="px-3 py-3 text-center text-xs text-muted-foreground">
										Nenhum usuário encontrado.
									</p>
								) : (
									<ul className="divide-y divide-border">
										{matchingUsers.map((u: User) => {
											const isMember = memberUserIds.has(u.id);
											const isSelected = selectedUserId === u.id;
											return (
												<li key={u.id}>
													<button
														type="button"
														onClick={() => {
															setSelectedUserId(u.id);
															setQuery(`${u.name} (${u.email})`);
														}}
														className={[
															'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-secondary',
															isSelected ? 'bg-secondary' : '',
														].join(' ')}
													>
														<div className="min-w-0 flex-1">
															<div className="truncate text-xs font-medium text-foreground">
																{u.name || u.email}
															</div>
															<div className="truncate font-mono text-[10px] text-muted-foreground">
																{u.email}
															</div>
														</div>
														{isMember && (
															<span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[9px] text-muted-foreground">
																já é membro
															</span>
														)}
													</button>
												</li>
											);
										})}
									</ul>
								)}
							</ScrollArea>
							{/* No match → invite on the Users page */}
							{noMatch && (
								<button
									type="button"
									onClick={() => router.push(ROUTES.users)}
									className="flex w-full items-center justify-center gap-1.5 border-t border-border px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-secondary"
								>
									<ExternalLink className="h-3 w-3" />
									Usuário não encontrado — adicionar novo convite
								</button>
							)}
						</div>
					)}
				</div>

				{/* Selected + role + add button */}
				<div className="flex items-center gap-2">
					<Select value={role} onValueChange={(v) => setRole(v as CompanyRole)}>
						<SelectTrigger className="h-8 w-40">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{ROLES.map((r) => (
								<SelectItem key={r.value} value={r.value}>
									{r.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Button
						type="submit"
						size="sm"
						className="h-8 gap-1.5"
						disabled={adding || !selectedUser}
					>
						<UserPlus className="h-3.5 w-3.5" />
						{adding ? 'Adicionando…' : 'Adicionar'}
					</Button>
				</div>
			</form>

			{/* ── Current members ── */}
			<div className="rounded-lg border border-border">
				<div className="border-b border-border px-3 py-2">
					<span className="text-xs font-medium text-foreground">
						Membros atuais ({(members.data?.data ?? []).length})
					</span>
				</div>
				{members.loading ? (
					<p className="p-4 text-sm text-muted-foreground">Carregando…</p>
				) : (members.data?.data ?? []).length === 0 ? (
					<Empty title="Sem membros" description="Adicione o primeiro membro acima." />
				) : (
					<ul className="divide-y divide-border">
						{(members.data?.data ?? []).map((m) => (
							<li key={m.userId} className="flex items-center gap-2 px-3 py-2">
								<div className="min-w-0 flex-1">
									<div className="truncate text-xs font-medium text-foreground">
										{m.name || m.email}
									</div>
									<Id value={m.email} className="text-[10px] text-muted-foreground" />
								</div>
								<Select
									value={(m.role as CompanyRole) ?? 'viewer'}
									onValueChange={(v) => changeRole(m, v as CompanyRole)}
								>
									<SelectTrigger className="h-7 w-36 text-xs">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{ROLES.map((r) => (
											<SelectItem key={r.value} value={r.value}>
												{r.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<Button
									variant="ghost"
									size="icon"
									className="h-7 w-7 shrink-0 text-signal-fault"
									onClick={() => remove(m)}
									aria-label="Remover"
								>
									<Trash2 className="h-3.5 w-3.5" />
								</Button>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}

/**
 * <MembersManager> — the public trigger: a members-count button that opens a
 * dialog hosting <MembersBody> for the given company.
 */
export function MembersManager({ company }: { company: Company }) {
	const [open, setOpen] = React.useState(false);
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="ghost" size="sm">
					<Users className="h-4 w-4" />
					{company.memberCount}
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>Membros — {company.name}</DialogTitle>
					<DialogDescription>
						Pesquise, adicione, promova e remova membros desta empresa.
					</DialogDescription>
				</DialogHeader>
				{open && <MembersBody companyId={company.id} />}
			</DialogContent>
		</Dialog>
	);
}
