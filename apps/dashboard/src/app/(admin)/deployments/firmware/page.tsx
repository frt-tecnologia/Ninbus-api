'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Cpu, HardDrive } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Section } from '@/components/system';
import { FirmwareTable } from '@/components/domain/firmware/firmware-table';
import { FirmwareUploadDialog } from '@/components/domain/firmware/firmware-upload-dialog';
import { useFetch } from '@/hooks/useFetch';
import { firmwareService } from '@/lib/api';
import type { FirmwareRelease } from '@/types/domain';

/**
 * Firmware — the factory's firmware release catalog, nested under the
 * Deployments section (route /deployments/firmware). Super admin only
 * (the whole (admin) area is guarded server-side by requireAdmin).
 *
 * Publish → the API packages the device .tar contract and registers the
 * release globally; every company's "latest version" follows this catalog.
 */
export default function FirmwarePage() {
	const router = useRouter();
	const releases = useFetch(useCallback(() => firmwareService.list(), []));
	const [deleting, setDeleting] = useState<string | null>(null);

	async function handleDelete(release: FirmwareRelease) {
		if (
			!window.confirm(
				`Excluir a release ${release.version} (${release.name}) do catálogo?\n` +
					'Releases já enviadas a dispositivos deixam o catálogo, mas o binário permanece no servidor de atualização como histórico.',
			)
		)
			return;
		setDeleting(release.id);
		const result = await firmwareService
			.remove(release.id)
			.then((res) => res as { message?: string; hawkbitKept?: boolean; error?: undefined })
			.catch((e: unknown) => ({ error: e instanceof Error ? e.message : 'Falha ao excluir' }) as { error: string; message?: undefined; hawkbitKept?: undefined });
		setDeleting(null);
		if ('error' in result && result.error) {
			toast.error(result.error);
			return;
		}
		if (result.hawkbitKept) {
			toast.warning(
				result.message ??
						`Release ${release.version} removida do catálogo (binário mantido no hawkBit como histórico).`,
			);
		} else {
			toast.success(result.message ?? `Release ${release.version} excluída.`);
		}
		releases.refetch();
	}

	const list = releases.data?.data ?? [];
	const ninbusCount = list.filter((r) => r.artifactType === 'firmware-ninbus').length;
	const controllerCount = list.filter((r) => r.artifactType === 'firmware-controller').length;

	return (
		<>
			<PageHeader
				title="Firmware"
				description="Catálogo de releases de firmware da fábrica — publica atualizações para toda a frota."
				action={
					<>
						<button
							type="button"
							onClick={() => router.push('/deployments')}
							className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
						>
							<ArrowLeft className="h-4 w-4" />
							Deployments
						</button>
						<FirmwareUploadDialog onDone={() => releases.refetch()} />
					</>
				}
			/>

			<Section
				title="Releases"
				description="Ordem cronológica. Rascunhos (testes da fábrica) ficam invisíveis para os clientes até serem publicados; a versão publicada mais alta de cada tipo define a atualização disponível."
				className="mb-4"
			>
				<div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
					<span className="inline-flex items-center gap-1.5">
						<HardDrive className="h-4 w-4" />
						{ninbusCount} release(s) Firmware Ninbus
					</span>
					<span className="inline-flex items-center gap-1.5">
						<Cpu className="h-4 w-4" />
						{controllerCount} release(s) Firmware Controlador
					</span>
				</div>
			</Section>

			<FirmwareTable
				releases={list}
				loading={releases.loading}
				error={releases.error}
				onRetry={releases.refetch}
				onDelete={handleDelete}
				onChanged={releases.refetch}
			/>
			{deleting && <p className="sr-only">Excluindo release…</p>}
		</>
	);
}
