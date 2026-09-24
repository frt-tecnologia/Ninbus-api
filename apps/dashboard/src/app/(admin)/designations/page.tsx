'use client';

import { DesignationTable } from '@/components/domain/companies/designation-table';
import { PageHeader } from '@/components/layout/page-header';

export default function DesignationsPage() {
	return (
		<>
			<PageHeader
				title="Designações"
				description="Convites por email aguardando registro — cancele pendências aqui."
			/>
			<DesignationTable />
		</>
	);
}
