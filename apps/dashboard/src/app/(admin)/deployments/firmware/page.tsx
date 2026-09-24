'use client';

import { ArrowLeft, Cpu, HardDrive } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { FirmwareTable } from '@/components/domain/firmware/firmware-table';
import { FirmwareUploadDialog } from '@/components/domain/firmware/firmware-upload-dialog';
import { PageHeader } from '@/components/layout/page-header';
import { Section } from '@/components/system';
import { ConfirmDialog } from '@/components/system/confirm-dialog';
import { useFetch } from '@/hooks/useFetch';
import { ApiClientError, firmwareService } from '@/lib/api';
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
	const [toDelete, setToDelete] = useState<FirmwareRelease | null>(null);
	const [realignPending, setRealignPending] = useState<FirmwareRelease | null>(null);

	async function handleDelete() {
		const release = toDelete;
		if (!release) return;
		setDeleting(release.id);
		try {
			const res = await firmwareService.remove(release.id);
			if (res?.hawkbitKept) {
				toast.warning(
					res.message ??
						`Release ${release.version} removida do catálogo (binário mantido no hawkBit como histórico).`,
				);
			} else {
				toast.success(res?.message ?? `Release ${release.version} excluída.`);
			}
			setToDelete(null);
		} catch (e) {
			if (
				e instanceof ApiClientError &&
				(e.raw as { code?: string } | undefined)?.code === 'COUNTER_FLOOR_BURNED'
			) {
				setRealignPending(release);
			} else {
				toast.error(e instanceof Error ? e.message : 'Falha ao excluir');
			}
		} finally {
			setDeleting(null);
			releases.refetch();
		}
	}

	async function handleDeleteRealign() {
		const release = realignPending;
		if (!release) return;
		setDeleting(release.id);
		try {
			const res = await firmwareService.remove(release.id, { realignFloor: true });
			toast.success(
				res?.message ??
					`Release ${release.version} excluída (piso do counter transferido para a release mais antiga).`,
			);
			setRealignPending(null);
			setToDelete(null);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Falha ao excluir com realinhamento');
		} finally {
			setDeleting(null);
			releases.refetch();
		}
	}

	const list = releases.data?.data ?? [];
	const ninbusCount = list.filter((r) => r.artifactType === 'firmware-ninbus').length;
	const controllerCount = list.filter((r) => r.artifactType === 'firmware-controller').length;

	return (
		<>
			<PageHeader
				title="Firmware"
				description="Catálogo de releases da fábrica."
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
				description="Rascunhos ficam invisíveis para clientes até a publicação. A versão publicada mais alta define a atualização disponível."
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
				onDelete={setToDelete}
				onChanged={releases.refetch}
			/>
			<ConfirmDialog
				open={toDelete !== null}
				onOpenChange={(o) => !o && setToDelete(null)}
				destructive
				title={`Excluir a release ${toDelete?.version ?? ''} (${toDelete?.name ?? ''})?`}
				description="Já enviada a dispositivos, a release sai do catálogo, mas o binário permanece como histórico."
				confirmLabel="Excluir"
				onConfirm={handleDelete}
			/>
			<ConfirmDialog
				open={realignPending !== null}
				onOpenChange={(o) => !o && setRealignPending(null)}
				destructive
				title={`Excluir ${realignPending?.version ?? ''} transferindo o piso do counter?`}
				description="Esta release foi servida aos devices e é a única portadora do counter — o bootloader não devolve o piso. A exclusão transfere o counter para a release mais antiga do mesmo tipo, preservando a proteção anti-replay."
				confirmLabel="Excluir transferindo o piso"
				onConfirm={handleDeleteRealign}
			/>
			{deleting && <p className="sr-only">Excluindo release…</p>}
		</>
	);
}
