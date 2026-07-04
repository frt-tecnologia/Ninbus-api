'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import type { PendingDesignation } from '@/types/domain';
import { DataTable, type Column } from '@/components/data/data-table';
import { Id, Time } from '@/components/system';
import { Button } from '@/components/ui/button';
import { useFetch } from '@/hooks/useFetch';
import { designationService } from '@/lib/api';
import { notifyDataChanged } from '@/lib/data-events';

export function DesignationTable() {
	const router = useRouter();
	const designations = useFetch(useCallback(() => designationService.listPending(), []));

	async function cancel(d: PendingDesignation) {
		const err = await designationService
			.cancel(d.companyId, d.id)
			.then(() => null)
			.catch((e: unknown) => (e instanceof Error ? e.message : 'Falha'));
		if (err) return toast.error(err);
		toast.success('Designação cancelada.');
		notifyDataChanged();
		router.refresh();
		designations.refetch();
	}

	const columns: Column<PendingDesignation>[] = [
		{
			key: 'email',
			header: 'Email',
			sortValue: (d) => d.email,
			render: (d) => <Id value={d.email} />,
		},
		{
			key: 'company',
			header: 'Empresa',
			sortValue: (d) => d.companyName,
			render: (d) => (
				<Link
					href={`/companies/${d.companyId}`}
					className="text-sm text-foreground hover:text-primary hover:underline"
				>
					{d.companyName}
				</Link>
			),
		},
		{
			key: 'role',
			header: 'Role',
			sortValue: (d) => d.role,
			render: (d) => <span className="font-mono text-xs uppercase text-muted-foreground">{d.role}</span>,
		},
		{
			key: 'claimed',
			header: 'Registro',
			render: (d) =>
				d.claimedAt ? (
					<span className="text-signal-ok">claimado</span>
				) : (
					<span className="text-signal-busy">aguardando</span>
				),
		},
		{ key: 'createdAt', header: 'Criada', sortValue: (d) => d.createdAt, render: (d) => <Time value={d.createdAt} /> },
	];

	return (
		<DataTable
			columns={columns}
			rows={designations.data?.data ?? []}
			rowKey={(d) => d.id}
			loading={designations.loading}
			error={designations.error}
			onRetry={designations.refetch}
			empty={<div className="py-12 text-center text-sm text-muted-foreground">Nenhuma designação pendente.</div>}
			actions={(d) =>
				!d.claimedAt && (
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8 text-signal-fault"
						onClick={() => cancel(d)}
						aria-label="Cancelar"
					>
						<X className="h-4 w-4" />
					</Button>
				)
			}
		/>
	);
}
