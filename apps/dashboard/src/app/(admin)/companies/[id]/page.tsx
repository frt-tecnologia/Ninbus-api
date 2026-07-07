'use client';

import { useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { CompanyObservability } from '@/components/domain/observability/company-observability';
import { useFetch } from '@/hooks/useFetch';
import { companyService } from '@/lib/api';
import { Button } from '@/components/ui/button';

/**
 * Company observability page — the "select a company → see its connectivity,
 * groups, and logs" view requested by the spec. Renders the three-section
 * <CompanyObservability> container for the selected company.
 *
 * The flat company LIST remains available at /companies; clicking a company
 * name navigates here. A back button returns to the list.
 */
export default function CompanyObservabilityPage() {
	const params = useParams<{ id: string }>();
	const router = useRouter();
	const companyId = params.id;

	const company = useFetch(
		useCallback(() => companyService.get(companyId), [companyId]),
		[companyId],
		false,
	);

	return (
		<>
			<PageHeader
				title={company.data?.name ?? 'Carregando…'}
				description="Observabilidade da empresa — conectividade, grupos e auditoria."
				action={
					<Button
						variant="outline"
						size="sm"
						onClick={() => router.push('/companies')}
						className="h-8"
					>
						<ArrowLeft className="mr-1.5 h-4 w-4" />
						Voltar à lista
					</Button>
				}
			/>
			{company.error ? (
				<p className="py-12 text-center text-sm text-muted-foreground">
					Empresa não encontrada ou você não tem acesso.
				</p>
			) : (
				<CompanyObservability companyId={companyId} />
			)}
		</>
	);
}
