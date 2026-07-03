'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { MoreVertical, Power, PowerOff, Trash2 } from 'lucide-react';
import type { Company } from '@/types/domain';
import type { SignalToken } from '@/lib/design/tokens';
import { DataTable, type Column } from '@/components/data/data-table';
import { Signal, Id, Time } from '@/components/system';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { companyService } from '@/lib/api';
import { notifyDataChanged } from '@/lib/data-events';
import { MembersManager } from './members-manager';

function companyStatus(s: string): SignalToken {
	return s === 'suspended'
		? { tone: 'idle', shape: 'square', label: 'Suspensa' }
		: { tone: 'ok', shape: 'dot', label: 'Ativa' };
}

export function CompanyTable({
	companies,
	loading,
	error,
	onRetry,
	onMutate,
}: {
	companies: Company[];
	loading: boolean;
	error: string | null;
	onRetry: () => void;
	/** Called after any mutation (suspend / reactivate / delete). The parent
	 * passes its useFetch().refetch so the table re-loads immediately. */
	onMutate?: () => void;
}) {
	const router = useRouter();

	async function toggle(c: Company) {
		const next = c.status === 'suspended' ? 'active' : 'suspended';
		const err = await companyService
			.setStatus(c.id, { status: next })
			.then(() => null)
			.catch((e: unknown) => (e instanceof Error ? e.message : 'Falha'));
		if (err) return toast.error(err);
		toast.success(next === 'suspended' ? 'Empresa suspensa.' : 'Empresa reativada.');
		notifyDataChanged();
		router.refresh();
		onMutate?.();
	}

	async function remove(c: Company) {
		if (!confirm(`Excluir a empresa "${c.name}"? Esta ação é definitiva.`)) return;
		const err = await companyService
			.remove(c.id)
			.then(() => null)
			.catch((e: unknown) => (e instanceof Error ? e.message : 'Falha'));
		if (err) return toast.error(err);
		toast.success('Empresa excluída.');
		notifyDataChanged();
		router.refresh();
		onMutate?.();
	}

	const columns: Column<Company>[] = [
		{
			key: 'name',
			header: 'Empresa',
			sortValue: (c) => c.name,
			render: (c) => (
				<div className="flex flex-col">
					<Link href={`/companies/${c.id}`} className="text-sm font-medium text-foreground hover:text-primary hover:underline">
						{c.name}
					</Link>
					<Id value={c.id} truncate className="text-xs text-muted-foreground" />
				</div>
			),
		},
		{
			key: 'status',
			header: 'Status',
			sortValue: (c) => c.status,
			render: (c) => <Signal token={companyStatus(c.status)} size="sm" />,
		},
		{ key: 'members', header: 'Membros', render: (c) => <MembersManager company={c} /> },
		{
			key: 'devices',
			header: 'Devices',
			sortValue: (c) => c.deviceCount,
			render: (c) => <span className="font-mono tabular-nums text-sm">{c.deviceCount}</span>,
		},
		{
			key: 'pending',
			header: 'Pendentes',
			sortValue: (c) => c.pendingCount,
			render: (c) => (
				<span className="font-mono tabular-nums text-sm text-muted-foreground">{c.pendingCount}</span>
			),
		},
		{ key: 'createdAt', header: 'Criada', sortValue: (c) => c.createdAt, render: (c) => <Time value={c.createdAt} /> },
	];

	return (
		<DataTable
			columns={columns}
			rows={companies}
			rowKey={(c) => c.id}
			loading={loading}
			error={error}
			onRetry={onRetry}
			empty={
				<div className="py-12 text-center text-sm text-muted-foreground">
					Nenhuma empresa cadastrada.
				</div>
			}
			actions={(c) => (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Ações">
							<MoreVertical className="h-4 w-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						{c.status === 'suspended' ? (
							<DropdownMenuItem onClick={() => toggle(c)}>
								<Power className="h-4 w-4" /> Reativar
							</DropdownMenuItem>
						) : (
							<DropdownMenuItem onClick={() => toggle(c)}>
								<PowerOff className="h-4 w-4" /> Suspender
							</DropdownMenuItem>
						)}
						<DropdownMenuSeparator />
						<DropdownMenuItem className="text-signal-fault focus:text-signal-fault" onClick={() => remove(c)}>
							<Trash2 className="h-4 w-4" /> Excluir
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			)}
		/>
	);
}
