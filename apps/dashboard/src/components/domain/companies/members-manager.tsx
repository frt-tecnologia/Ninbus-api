'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Trash2, Users } from 'lucide-react';
import type { Company } from '@/types/domain';
import type { CompanyRole, Member } from '@/lib/api';
import { memberService } from '@/lib/api';
import { notifyDataChanged } from '@/lib/data-events';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { Empty, Id } from '@/components/system';
import { useFetch } from '@/hooks/useFetch';
import { useCallback } from 'react';
import { MemberAddForm, ROLES } from './member-add-form';

/**
 * <MembersManager> — opens a dialog listing a company's members, with add
 * (search → select → role → add via <MemberAddForm>), role change (select) and
 * remove (trash) actions.
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
						Atribua, promova e remova membros desta empresa.
					</DialogDescription>
				</DialogHeader>
				{open && <MembersBody companyId={company.id} />}
			</DialogContent>
		</Dialog>
	);
}

function MembersBody({ companyId }: { companyId: string }) {
	const router = useRouter();
	const members = useFetch(useCallback(() => memberService.list(companyId), [companyId]));

	const memberUserIds = React.useMemo(
		() => new Set((members.data?.data ?? []).map((m) => m.userId)),
		[members.data],
	);

	async function changeRole(m: Member, next: CompanyRole) {
		const err = await memberService
			.updateRole(companyId, m.userId, { role: next })
			.then(() => null)
			.catch((e: unknown) => (e instanceof Error ? e.message : 'Falha'));
		if (err) return toast.error(err);
		toast.success('Role atualizada.');
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
		router.refresh();
		members.refetch();
	}

	return (
		<div className="mt-4 flex flex-col gap-4">
			<MemberAddForm
				companyId={companyId}
				memberUserIds={memberUserIds}
				onAdded={() => {
					router.refresh();
					members.refetch();
				}}
			/>

			{/* ── Current members ── */}
			<div className="rounded-lg border border-border">
				{members.loading ? (
					<p className="p-4 text-sm text-muted-foreground">Carregando…</p>
				) : (members.data?.data ?? []).length === 0 ? (
					<Empty title="Sem membros" description="Adicione o primeiro membro acima." />
				) : (
					<ul className="divide-y divide-border">
						{(members.data?.data ?? []).map((m) => (
							<li key={m.userId} className="flex items-center gap-2 px-3 py-2">
								<div className="min-w-0 flex-1">
									<div className="truncate text-sm font-medium">{m.name || m.email}</div>
									<Id value={m.email} className="text-xs text-muted-foreground" />
								</div>
								<Select
									value={(m.role as CompanyRole) ?? 'viewer'}
									onValueChange={(v) => changeRole(m, v as CompanyRole)}
								>
									<SelectTrigger className="h-8 w-28">
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
									className="h-8 w-8 text-signal-fault"
									onClick={() => remove(m)}
									aria-label="Remover"
								>
									<Trash2 className="h-4 w-4" />
								</Button>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
