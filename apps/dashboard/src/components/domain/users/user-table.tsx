'use client';

import { type Column, DataTable } from '@/components/data/data-table';
import { Id, Signal, Time } from '@/components/system';
import type { SignalToken } from '@/lib/design/tokens';
import type { User } from '@/types/domain';
import Link from 'next/link';

function roleSignal(u: User): SignalToken {
	return u.isSuperAdmin
		? { tone: 'info', shape: 'diamond', label: 'Super admin' }
		: u.companyCount > 0
			? { tone: 'ok', shape: 'dot', label: 'Membro' }
			: { tone: 'idle', shape: 'ring', label: 'Sem empresa' };
}

/**
 * <UserTable> — registered-accounts table. Search filters by name + email
 * (custom predicate, delegated to <DataTable> which now actually filters).
 */
export function UserTable({
	users,
	loading,
	error,
	onRetry,
	search,
}: {
	users: User[];
	loading: boolean;
	error: string | null;
	onRetry: () => void;
	search: { value: string; onChange: (v: string) => void; placeholder?: string };
}) {
	// Search predicate: match name OR email (the human-readable fields).
	const filter = (u: User, term: string) =>
		u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term);

	const columns: Column<User>[] = [
		{
			key: 'email',
			header: 'Usuário',
			sortValue: (u) => u.email,
			render: (u) => (
				<div className="flex flex-col">
					<Link
						href={`/users/${u.id}`}
						className="text-sm font-medium text-foreground hover:text-primary hover:underline"
					>
						{u.name || u.email}
					</Link>
					<Id value={u.email} className="text-xs text-muted-foreground" />
				</div>
			),
		},
		{
			key: 'role',
			header: 'Função',
			sortValue: (u) => (u.isSuperAdmin ? '1' : '0'),
			render: (u) => <Signal token={roleSignal(u)} size="sm" />,
		},
		{
			key: 'companies',
			header: 'Empresas',
			sortValue: (u) => u.companyCount,
			render: (u) => <span className="font-mono tabular-nums text-sm">{u.companyCount}</span>,
		},
		{
			key: 'verified',
			header: 'Email',
			sortValue: (u) => (u.emailVerified ? '1' : '0'),
			render: (u) => (
				<span className={u.emailVerified ? 'text-signal-ok' : 'text-signal-busy'}>
					{u.emailVerified ? 'verificado' : 'pendente'}
				</span>
			),
		},
		{
			key: 'createdAt',
			header: 'Cadastro',
			sortValue: (u) => u.createdAt,
			render: (u) => <Time value={u.createdAt} />,
		},
	];

	return (
		<DataTable
			columns={columns}
			rows={users}
			rowKey={(u) => u.id}
			loading={loading}
			error={error}
			onRetry={onRetry}
			search={{ ...search, filter, hideInput: true }}
			empty={<div className="py-12 text-center text-sm text-muted-foreground">Nenhum usuário.</div>}
		/>
	);
}
