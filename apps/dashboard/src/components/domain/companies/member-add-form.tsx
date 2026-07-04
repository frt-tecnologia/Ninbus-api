'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { UserPlus, X } from 'lucide-react';
import type { User } from '@/types/domain';
import type { CompanyRole } from '@/lib/api';
import { memberService, userService } from '@/lib/api';
import { notifyDataChanged } from '@/lib/data-events';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { useFetch } from '@/hooks/useFetch';
import { useCallback } from 'react';

const ROLES: { value: CompanyRole; label: string }[] = [
	{ value: 'owner', label: 'Owner' },
	{ value: 'admin', label: 'Admin' },
	{ value: 'operator', label: 'Operator' },
	{ value: 'viewer', label: 'Viewer' },
];

/**
 * <MemberAddForm> — the "add member" combobox inside the members dialog.
 *
 * Search-and-select over ALL platform users. Clicking a user SELECTS it
 * (stores the user object, not text), so the email submitted to the API always
 * comes from that object — never a "name (email)" string. When the typed query
 * is a valid email that matches nobody, it is added directly as a pending
 * designation (the API creates one for not-yet-registered emails).
 */
export function MemberAddForm({
	companyId,
	memberUserIds,
	onAdded,
}: {
	companyId: string;
	memberUserIds: Set<string>;
	onAdded: () => void;
}) {
	const router = useRouter();
	const platformUsers = useFetch(useCallback(() => userService.list(), []));

	const [query, setQuery] = React.useState('');
	const [selectedUser, setSelectedUser] = React.useState<User | null>(null);
	const [role, setRole] = React.useState<CompanyRole>('viewer');
	const [adding, setAdding] = React.useState(false);

	const matches = React.useMemo(() => {
		const term = query.trim().toLowerCase();
		const all = platformUsers.data?.data ?? [];
		if (!term) return all.slice(0, 8);
		return all
			.filter(
				(u) =>
					u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term),
			)
			.slice(0, 8);
	}, [platformUsers.data, query]);

	const emailInput = query.trim();
	const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput);
	const submitEmail = selectedUser?.email ?? (looksLikeEmail ? emailInput : '');
	const dropdownOpen = query.trim().length > 0 && !selectedUser;

	async function add(e: React.FormEvent) {
		e.preventDefault();
		if (!submitEmail) return;
		setAdding(true);
		const err = await memberService
			.add(companyId, { email: submitEmail, role })
			.then(() => null)
			.catch((e: unknown) => (e instanceof Error ? e.message : 'Falha'));
		setAdding(false);
		if (err) return toast.error(err);
		toast.success('Membro adicionado.');
		setQuery('');
		setSelectedUser(null);
		notifyDataChanged();
		router.refresh();
		onAdded();
	}

	return (
		<form onSubmit={add} className="space-y-2">
			<span className="text-xs font-medium text-foreground">Adicionar membro</span>

			{/* Selected user chip OR search field */}
			{selectedUser ? (
				<div className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2">
					<div className="min-w-0 flex-1">
						<div className="truncate text-sm font-medium">{selectedUser.name}</div>
						<div className="truncate font-mono text-[10px] text-muted-foreground">
							{selectedUser.email}
						</div>
					</div>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="h-6 w-6 shrink-0"
						onClick={() => {
							setSelectedUser(null);
							setQuery('');
						}}
						aria-label="Remover seleção"
					>
						<X className="h-3.5 w-3.5" />
					</Button>
				</div>
			) : (
				<div className="relative">
					<Input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Pesquisar por nome ou email…"
						autoFocus
					/>
					{dropdownOpen && (
						<div className="absolute left-0 right-0 top-full z-[100] mt-1 rounded-md border border-border bg-popover shadow-lg">
							<ScrollArea className="max-h-56">
								{matches.length === 0 ? (
									<p className="px-3 py-3 text-center text-xs text-muted-foreground">
										{looksLikeEmail
											? `Novo convite para "${emailInput}".`
											: 'Nenhum usuário encontrado.'}
									</p>
								) : (
									<ul className="divide-y divide-border">
										{matches.map((u: User) => {
											const isMember = memberUserIds.has(u.id);
											return (
												<li key={u.id}>
													<button
														type="button"
														onClick={() => {
															setSelectedUser(u);
															setQuery('');
														}}
														className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-secondary"
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
						</div>
					)}
				</div>
			)}

			{/* Role + Add */}
			<div className="flex items-center gap-2">
				<Select value={role} onValueChange={(v) => setRole(v as CompanyRole)}>
					<SelectTrigger className="h-9 w-32">
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
				<Button type="submit" size="sm" disabled={adding || !submitEmail} className="gap-1.5">
					<UserPlus className="h-3.5 w-3.5" />
					{adding ? 'Adicionando…' : 'Adicionar'}
				</Button>
			</div>
			{!selectedUser && looksLikeEmail && (
				<p className="text-[10px] text-muted-foreground">
					O email não tem conta — será criado um convite pendente.
				</p>
			)}
		</form>
	);
}

export { ROLES };
