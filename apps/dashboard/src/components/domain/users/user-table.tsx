'use client';

import type { User } from '@/types/domain';
import { DataTable, type Column } from '@/components/data/data-table';
import { Id, Time, Signal } from '@/components/system';
import type { SignalToken } from '@/lib/design/tokens';

function roleSignal(u: User): SignalToken {
	return u.isSuperAdmin
		? { tone: 'info', shape: 'diamond', label: 'Super admin' }
		: u.companyCount > 0
			? { tone: 'ok', shape: 'dot', label: 'Membro' }
			: { tone: 'idle', shape: 'ring', label: 'Sem empresa' };
}

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
	const columns: Column<User>[] = [
		{
			key: 'email',
			header: 'Usuário',
			sortValue: (u) => u.email,
			render: (u) => (
				<div className="flex flex-col">
					<span className="text-sm font-medium">{u.name || u.email}</span>
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
			render: (u) => (
				<span className="font-mono tabular-nums text-sm">{u.companyCount}</span>
			),
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
		{ key: 'createdAt', header: 'Cadastro', sortValue: (u) => u.createdAt, render: (u) => <Time value={u.createdAt} /> },
	];

	return (
		<DataTable
			columns={columns}
			rows={users}
			rowKey={(u) => u.id}
			loading={loading}
			error={error}
			onRetry={onRetry}
			search={search}
			empty={<div className="py-12 text-center text-sm text-muted-foreground">Nenhum usuário.</div>}
		/>
	);
}
