'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CloudUpload, EyeOff, FlaskConical, MoreHorizontal, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { firmwareService } from '@/lib/api';
import type { FirmwareRelease } from '@/types/domain';
import { ConfirmDialog } from '@/components/system/confirm-dialog';
import { FirmwareTestDialog } from './firmware-test-dialog';

/**
 * Publish-gate row actions for the firmware table (dropdown menu):
 *  - draft:     Publicar (latest for end users) + Testar em dispositivos
 *  - published: Retirar do ar (emergency brake)
 *  - always:    Excluir (catalog row; locked binaries stay on hawkBit)
 */
export function FirmwareGateActions({
	release,
	onDelete,
	onChanged,
}: {
	release: FirmwareRelease;
	/** Opens the page-level delete ConfirmDialog for this release. */
	onDelete: (release: FirmwareRelease) => void;
	onChanged?: () => void;
}) {
	const router = useRouter();
	const [busy, setBusy] = React.useState(false);
	const [testOpen, setTestOpen] = React.useState(false);
	const [pendingFlip, setPendingFlip] = React.useState<'publish' | 'unpublish' | null>(null);

	async function flip(action: 'publish' | 'unpublish') {
		const isPublish = action === 'publish';
		setBusy(true);
		try {
			const res = isPublish
				? await firmwareService.publish(release.id)
				: await firmwareService.unpublish(release.id);
			toast.success((res as { message?: string }).message ?? 'Status atualizado');
			onChanged?.();
			router.refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Falha ao alterar o status');
		} finally {
			setBusy(false);
		}
	}

	return (
		<>
			<FirmwareTestDialog release={release} open={testOpen} onOpenChange={setTestOpen} />
			<ConfirmDialog
				open={pendingFlip !== null}
				onOpenChange={(o) => !o && setPendingFlip(null)}
				title={
					pendingFlip === 'publish'
						? `Publicar a release ${release.version}?`
						: `Retirar a release ${release.version} do ar?`
				}
				description={
					pendingFlip === 'publish'
						? 'Ela passa a ser a atualização disponível para TODOS os clientes.'
						: 'Ela deixa de aparecer para os clientes; deployments já atribuídos continuam.'
				}
				confirmLabel={pendingFlip === 'publish' ? 'Publicar' : 'Retirar do ar'}
				destructive={pendingFlip === 'unpublish'}
				onConfirm={() => (pendingFlip ? flip(pendingFlip) : undefined)}
			/>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="size-8 p-0"
						title="Ações da release"
						disabled={busy}
					>
						<MoreHorizontal />
						<span className="sr-only">Abrir menu de ações</span>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					{release.status === 'draft' ? (
						<>
							<DropdownMenuItem onClick={() => setPendingFlip('publish')}>
								<CloudUpload />
								Publicar
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => setTestOpen(true)}>
								<FlaskConical />
								Testar em dispositivos
							</DropdownMenuItem>
						</>
					) : (
						<DropdownMenuItem onClick={() => setPendingFlip('unpublish')}>
							<EyeOff />
							Retirar do ar
						</DropdownMenuItem>
					)}
					<DropdownMenuSeparator />
					<DropdownMenuItem
						className="text-destructive focus:text-destructive"
						onClick={() => onDelete(release)}
					>
						<Trash2 />
						Excluir
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</>
	);
}

/** draft/published pill for the firmware table version column. */
export function ReleaseStatusBadge({ status }: { status: 'draft' | 'published' }) {
	if (status === 'draft') {
		return (
			<span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-600 dark:text-amber-400">
				rascunho
			</span>
		);
	}
	return (
		<span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-emerald-600 dark:text-emerald-400">
			publicada
		</span>
	);
}
