'use client';

import { PageHeader } from '@/components/layout/page-header';
import { DesignationTable } from '@/components/domain/companies/designation-table';

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
