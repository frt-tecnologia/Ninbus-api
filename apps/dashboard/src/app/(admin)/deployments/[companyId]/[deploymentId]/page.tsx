'use client';
/**
 * Legacy `/deployments/:companyId/:deploymentId` — redirects to the merged
 * Deployments screen (Eixo D), preserving the detail deep link.
 */
import { redirect } from 'next/navigation';

export default async function DeploymentDetailRedirect({
	params,
	searchParams,
}: {
	params: Promise<{ companyId: string; deploymentId: string }>;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const { companyId, deploymentId } = await params;
	const query = await searchParams;
	const extra = new URLSearchParams({ detail: deploymentId, company: companyId });
	if (query.detail) extra.set('detail', String(query.detail));
	redirect(`/deployments?${extra.toString()}`);
}
