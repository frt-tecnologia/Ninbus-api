'use client';
/**
 * Companies — Collection + create drawer, on real companies list.
 */
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import type { DataColumn } from '@/components/arc/sortable-data-table/sortable-data-table';
import s from '@/components/arc-app/app.module.css';
import { CompanyForm } from '@/components/arc-app/forms';
import { Guard, PageHead } from '@/components/arc-app/page-head';
import { type AnyRow, Button, Collection, Status, Surface } from '@/components/arc-app/primitives';
import { companyService } from '@/lib/api';
import { qk } from '@/lib/cache/keys';
import { useQuery } from '@/lib/cache/use-query';

export default function CompaniesPage() {
	const router = useRouter();
	const companies = useQuery(
		qk.adminCompanies,
		React.useCallback(() => companyService.list(), []),
	);
	const [form, setForm] = React.useState(false);

	const columns: DataColumn<AnyRow>[] = [
		{
			key: 'name',
			label: 'Empresa',
			render: (_, r) => (
				<button type="button" className={s.link} onClick={() => router.push(`/companies/${r.id}`)}>
					{r.name}
					<span className={s.cellSub}>
						{r.deviceCount} dispositivos · {r.memberCount} membros
					</span>
				</button>
			),
		},
		{ key: 'deviceCount', label: 'Dispositivos' },
		{ key: 'memberCount', label: 'Membros' },
		{ key: 'pendingCount', label: 'Pendências' },
		{ key: 'status', label: 'Estado', render: (v) => <Status value={String(v)} /> },
		{ key: 'createdAt', label: 'Criada em', sortable: true },
	];

	return (
		<>
			<PageHead
				title="Empresas"
				description="Organização, membros, dispositivos e diretrizes de cada empresa."
				actions={
					<Button onClick={() => setForm(true)}>
						<Plus size={17} />
						Criar empresa
					</Button>
				}
			/>
			<Guard loading={companies.loading} error={companies.error} onRetry={companies.refetch}>
				<div className="w-full overflow-x-auto">
					<div className="min-w-[900px]">
						<Collection
							label="Empresas"
							rows={companies.data?.data ?? []}
							onOpenRow={(r) => router.push(`/companies/${r.id}`)}
							columns={columns}
							dateKey="createdAt"
							fields={[{ id: 'status', label: 'Estado', options: ['active', 'suspended'] }]}
						/>
					</div>
				</div>
			</Guard>
			<Surface
				open={form}
				onClose={() => setForm(false)}
				title="Criar empresa"

			>
				<CompanyForm done={() => setForm(false)} />
			</Surface>
		</>
	);
}