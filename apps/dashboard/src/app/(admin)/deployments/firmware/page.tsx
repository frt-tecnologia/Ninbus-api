'use client';
/**
 * Legacy `/deployments/firmware` — redirects to the merged Deployments
 * screen (Firmware tab), preserving upload/detail deep links.
 */
import { redirect } from 'next/navigation';

export default async function FirmwareRedirect({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const query = await searchParams;
	const extra = new URLSearchParams({ tab: 'firmware' });
	if (query.upload) extra.set('upload', String(query.upload));
	if (query.detail) extra.set('detail', String(query.detail));
	redirect(`/deployments?${extra.toString()}`);
}
