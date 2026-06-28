'use client';

import { useMemo, useState } from 'react';
import type { Company } from '@/types/domain';
import { formatDateTime } from '@/lib/utils';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { SearchToolbar } from '@/components/tables/SearchToolbar';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState } from '@/components/ui/State';
import { ConfirmDialog } from '@/components/ui/Modal';
import { useMutation } from '@/hooks/useFetch';
import { companyService } from '@/lib/api';
import { Plus } from 'lucide-react';

interface RowAction {
	type: 'suspend' | 'activate' | 'delete';
	company: Company;
}

export function CompaniesTable({
	companies,
	loading,
	error,
	onRetry,
	onCreate,
	onChanged,
}: {
	companies: Company[];
	loading: boolean;
	error: string | null;
	onRetry: () => void;
	onCreate: () => void;
	onChanged: () => void;
}) {
	const [search, setSearch] = useState('');
	const [confirm, setConfirm] = useState<RowAction | null>(null);

	const setStatus = useMutation(
		async (c: Company, status: 'active' | 'suspended') =>
			companyService.setStatus(c.id, { status }),
	);
	const remove = useMutation(async (c: Company) => companyService.remove(c.id));

	const filtered = useMemo(() => {
		const term = search.trim().toLowerCase();
		if (!term) return companies;
		return companies.filter(
			(c) =>
				c.name.toLowerCase().includes(term) ||
				c.id.toLowerCase().includes(term),
		);
	}, [companies, search]);

	const columns: Column<Company>[] = [
		{
			key: 'name',
			header: 'Empresa',
			sortable: true,
			sortValue: (c) => c.name,
			render: (c) => <span className="font-medium text-gray-900">{c.name}</span>,
		},
		{
			key: 'status',
			header: 'Status',
			sortable: true,
			sortValue: (c) => c.status,
			render: (c) => (
				<StatusBadge
					meta={{
						label: c.status === 'active' ? 'Ativa' : 'Suspensa',
						variant: c.status === 'active' ? 'success' : 'neutral',
					}}
				/>
			),
		},
		{
			key: 'members',
			header: 'Membros',
			sortable: true,
			sortValue: (c) => c.memberCount,
			render: (c) => <span>{c.memberCount}</span>,
		},
		{
			key: 'devices',
			header: 'Dispositivos',
			sortable: true,
			sortValue: (c) => c.deviceCount,
			render: (c) => <span>{c.deviceCount}</span>,
		},
		{
			key: 'pending',
			header: 'Pendências',
			sortable: true,
			sortValue: (c) => c.pendingCount,
			render: (c) =>
				c.pendingCount > 0 ? (
					<span className="font-medium text-amber-600">{c.pendingCount}</span>
				) : (
					<span className="text-gray-400">0</span>
				),
		},
		{
			key: 'createdAt',
			header: 'Criada em',
			sortable: true,
			sortValue: (c) => c.createdAt,
			render: (c) => (
				<span className="text-gray-500">{formatDateTime(c.createdAt)}</span>
			),
		},
		{
			key: 'actions',
			header: 'Ações',
			render: (c) => (
				<div className="flex gap-1">
					{c.status === 'active' ? (
						<Button
							size="sm"
							variant="outline"
							onClick={() => setConfirm({ type: 'suspend', company: c })}
						>
							Suspender
						</Button>
					) : (
						<Button
							size="sm"
							variant="outline"
							onClick={() => setConfirm({ type: 'activate', company: c })}
						>
							Ativar
						</Button>
					)}
					<Button
						size="sm"
						variant="ghost"
						className="text-red-600 hover:bg-red-50"
						onClick={() => setConfirm({ type: 'delete', company: c })}
					>
						Excluir
					</Button>
				</div>
			),
		},
	];

	if (error) return <ErrorState message={error} onRetry={onRetry} />;

	async function runConfirm() {
		if (!confirm) return;
		const { type, company } = confirm;
		let ok: unknown = null;
		if (type === 'suspend') ok = await setStatus.run(company, 'suspended');
		else if (type === 'activate') ok = await setStatus.run(company, 'active');
		else ok = await remove.run(company);
		setConfirm(null);
		if (ok !== null) onChanged();
	}

	const actionLoading =
		confirm?.type === 'suspend' || confirm?.type === 'activate'
			? setStatus.loading
			: confirm?.type === 'delete'
				? remove.loading
				: false;

	return (
		<div>
			<SearchToolbar
				search={search}
				onSearchChange={setSearch}
				searchPlaceholder="Buscar por nome..."
				actions={[
					{
						label: 'Precadastrar',
						variant: 'primary',
						icon: <Plus className="h-4 w-4" />,
						onClick: onCreate,
					},
				]}
			/>
			<div className="rounded-xl border border-gray-200 bg-white">
				<DataTable
					columns={columns}
					rows={filtered}
					rowKey={(c) => c.id}
					loading={loading}
					emptyState={
						<EmptyState
							title="Nenhuma empresa encontrada"
							description="Precadastre a primeira empresa da plataforma."
						/>
					}
				/>
			</div>

			<ConfirmDialog
				open={confirm !== null}
				onClose={() => setConfirm(null)}
				onConfirm={runConfirm}
				loading={loading}
				title={
					confirm?.type === 'delete'
						? 'Excluir empresa'
						: confirm?.type === 'suspend'
							? 'Suspender empresa'
							: 'Ativar empresa'
				}
				confirmLabel={
					confirm?.type === 'delete'
						? 'Excluir'
						: confirm?.type === 'suspend'
							? 'Suspender'
							: 'Ativar'
				}
				message={
					confirm?.type === 'delete'
						? `Tem certeza que deseja excluir "${confirm?.company.name}"? Esta ação remove a empresa e seus vínculos. Não pode ser desfeita.`
						: confirm?.type === 'suspend'
							? `Suspender "${confirm?.company.name}"? Membros perderão acesso de escrita (leitura permanece).`
							: `Ativar "${confirm?.company.name}"? Membros recuperarão acesso de escrita.`
				}
			/>
		</div>
	);
}
