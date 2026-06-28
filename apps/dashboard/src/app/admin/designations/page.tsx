'use client';

import { useMemo, useState, useCallback } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { SearchToolbar } from '@/components/tables/SearchToolbar';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { EmptyState, ErrorState } from '@/components/ui/State';
import { Badge } from '@/components/ui/Badge';
import { useFetch, useMutation } from '@/hooks/useFetch';
import { designationService } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import type { PendingDesignation } from '@/types/domain';

export default function DesignationsPage() {
	const { data, loading, error, refetch } = useFetch(
		useCallback(() => designationService.listPending(), []),
	);
	const [search, setSearch] = useState('');
	const [cancel, setCancel] = useState<PendingDesignation | null>(null);

	const cancelMut = useMutation(async (d: PendingDesignation) =>
		designationService.cancel(d.companyId, d.id),
	);

	const rows = useMemo(() => {
		const term = search.trim().toLowerCase();
		const list = data?.data ?? [];
		if (!term) return list;
		return list.filter(
			(d) =>
				d.email.toLowerCase().includes(term) ||
				d.companyName.toLowerCase().includes(term),
		);
	}, [data, search]);

	const columns: Column<PendingDesignation>[] = [
		{
			key: 'email',
			header: 'Email',
			sortable: true,
			sortValue: (d) => d.email,
			render: (d) => (
				<span className="font-medium text-gray-900">{d.email}</span>
			),
		},
		{
			key: 'company',
			header: 'Empresa',
			sortable: true,
			sortValue: (d) => d.companyName,
			render: (d) => <span className="text-gray-600">{d.companyName}</span>,
		},
		{
			key: 'role',
			header: 'Papel',
			sortable: true,
			sortValue: (d) => d.role,
			render: (d) => <Badge variant="info">{d.role}</Badge>,
		},
		{
			key: 'createdAt',
			header: 'Designado em',
			sortable: true,
			sortValue: (d) => d.createdAt,
			render: (d) => (
				<span className="text-gray-500">{formatDateTime(d.createdAt)}</span>
			),
		},
		{
			key: 'actions',
			header: 'Ações',
			render: (d) => (
				<Button
					size="sm"
					variant="ghost"
					className="text-red-600 hover:bg-red-50"
					onClick={() => setCancel(d)}
				>
					Cancelar
				</Button>
			),
		},
	];

	return (
		<>
			<PageHeader
				title="Designações pendentes"
				description="Emails designados a empresas que ainda não completaram o registro. Serão resolvidos automaticamente quando o usuário se cadastrar."
			/>
			{error ? (
				<ErrorState message={error} onRetry={refetch} />
			) : (
				<>
					<SearchToolbar
						search={search}
						onSearchChange={setSearch}
						searchPlaceholder="Buscar por email ou empresa..."
					/>
					<div className="rounded-xl border border-gray-200 bg-white">
						<DataTable
							columns={columns}
							rows={rows}
							rowKey={(d) => d.id}
							loading={loading}
							emptyState={
								<EmptyState
									title="Nenhuma designação pendente"
									description="Todos os emails designados já completaram o registro."
								/>
							}
						/>
					</div>
				</>
			)}

			<ConfirmDialog
				open={cancel !== null}
				onClose={() => setCancel(null)}
				onConfirm={async () => {
					if (!cancel) return;
					const ok = await cancelMut.run(cancel);
					setCancel(null);
					if (ok !== null) refetch();
				}}
				loading={cancelMut.loading}
				title="Cancelar designação"
				confirmLabel="Cancelar designação"
				message={
					cancel
						? `Cancelar a designação de "${cancel.email}" para "${cancel.companyName}"? O usuário perderá o vínculo pendente.`
						: ''
				}
			/>
		</>
	);
}
