'use client';

import { useCallback, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { CompaniesTable } from '@/components/tables/CompaniesTable';
import { CreateCompanyDialog } from '@/components/forms/CreateCompanyDialog';
import { useFetch } from '@/hooks/useFetch';
import { companyService } from '@/lib/api';

export default function CompaniesPage() {
	const companies = useFetch(useCallback(() => companyService.list(), []));
	const [showCreate, setShowCreate] = useState(false);

	return (
		<>
			<PageHeader
				title="Empresas"
				description="Gerencie empresas: precadastro, suspender/ativar, excluir. Detalhes e membros por empresa."
			/>
			<CompaniesTable
				companies={companies.data?.data ?? []}
				loading={companies.loading}
				error={companies.error}
				onRetry={companies.refetch}
				onCreate={() => setShowCreate(true)}
				onChanged={companies.refetch}
			/>
			<CreateCompanyDialog
				open={showCreate}
				onClose={() => setShowCreate(false)}
				onCreated={companies.refetch}
			/>
		</>
	);
}
