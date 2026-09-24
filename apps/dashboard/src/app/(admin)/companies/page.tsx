'use client';

import { useCallback } from 'react';
import { CompanyCreateDialog } from '@/components/domain/companies/company-create-dialog';
import { CompanyTable } from '@/components/domain/companies/company-table';
import { PageHeader } from '@/components/layout/page-header';
import { useFetch } from '@/hooks/useFetch';
import { companyService } from '@/lib/api';

export default function CompaniesPage() {
	const companies = useFetch(useCallback(() => companyService.list(), []));
	return (
		<>
			<PageHeader
				title="Empresas"
				description="Precadastro, membros, suspensão e exclusão de tenants."
				action={<CompanyCreateDialog onDone={companies.refetch} />}
			/>
			<CompanyTable
				companies={companies.data?.data ?? []}
				loading={companies.loading}
				error={companies.error}
				onRetry={companies.refetch}
				onMutate={companies.refetch}
			/>
		</>
	);
}
