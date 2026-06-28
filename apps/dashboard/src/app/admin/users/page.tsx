'use client';

import { useMemo, useState, useCallback } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { SearchToolbar } from '@/components/tables/SearchToolbar';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, ErrorState, Spinner } from '@/components/ui/State';
import { useFetch } from '@/hooks/useFetch';
import { userService } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import type { User } from '@/types/domain';

export default function UsersPage() {
	const { data, loading, error, refetch } = useFetch(
		useCallback(() => userService.list(), []),
	);
	const [search, setSearch] = useState('');

	const users = useMemo(() => {
		const term = search.trim().toLowerCase();
		const list = data?.data ?? [];
		if (!term) return list;
		return list.filter(
			(u) =>
				u.name.toLowerCase().includes(term) ||
				u.email.toLowerCase().includes(term),
		);
	}, [data, search]);

	const columns: Column<User>[] = [
		{
			key: 'name',
			header: 'Nome',
			sortable: true,
			sortValue: (u) => u.name,
			render: (u) => <span className="font-medium text-gray-900">{u.name}</span>,
		},
		{
			key: 'email',
			header: 'Email',
			sortable: true,
			sortValue: (u) => u.email,
			render: (u) => <span className="text-gray-600">{u.email}</span>,
		},
		{
			key: 'companies',
			header: 'Empresas',
			sortable: true,
			sortValue: (u) => u.companyCount,
			render: (u) => <span>{u.companyCount}</span>,
		},
		{
			key: 'role',
			header: 'Nível',
			sortable: true,
			sortValue: (u) => (u.isSuperAdmin ? 'super' : 'user'),
			render: (u) =>
				u.isSuperAdmin ? (
					<Badge variant="danger">Super Admin</Badge>
				) : (
					<Badge variant="neutral">Usuário</Badge>
				),
		},
		{
			key: 'verified',
			header: 'Email verificado',
			sortable: true,
			sortValue: (u) => (u.emailVerified ? 1 : 0),
			render: (u) =>
				u.emailVerified ? (
					<Badge variant="success">Verificado</Badge>
				) : (
					<Badge variant="warning">Pendente</Badge>
				),
		},
		{
			key: 'createdAt',
			header: 'Criado em',
			sortable: true,
			sortValue: (u) => u.createdAt,
			render: (u) => (
				<span className="text-gray-500">{formatDateTime(u.createdAt)}</span>
			),
		},
	];

	return (
		<>
			<PageHeader
				title="Usuários"
				description="Todos os usuários cadastrados na plataforma. A promoção a Super Admin é controlada via variável de ambiente (SUPER_ADMIN_EMAILS)."
			/>
			{error ? (
				<ErrorState message={error} onRetry={refetch} />
			) : (
				<>
					<SearchToolbar
						search={search}
						onSearchChange={setSearch}
						searchPlaceholder="Buscar por nome ou email..."
					/>
					<div className="rounded-xl border border-gray-200 bg-white">
						<DataTable
							columns={columns}
							rows={users}
							rowKey={(u) => u.id}
							loading={loading}
							emptyState={
								<EmptyState
									title="Nenhum usuário encontrado"
									description="Usuários aparecem aqui após se cadastrarem."
								/>
							}
						/>
					</div>
				</>
			)}
		</>
	);
}
