'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CloudUpload, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { firmwareService } from '@/lib/api';
import type { FirmwareRelease } from '@/types/domain';
import { FirmwareTestDialog } from './firmware-test-dialog';

/**
 * Publish-gate row actions for the firmware table:
 *  - draft:    Publicar (make it the latest for end users) + Testar (pilots)
 *  - published: Retirar do ar (emergency brake — hides from end users)
 */
export function FirmwareGateActions({
	release,
	onChanged,
}: {
	release: FirmwareRelease;
	onChanged?: () => void;
}) {
	const router = useRouter();

	async function flip(action: 'publish' | 'unpublish') {
		const isPublish = action === 'publish';
		if (
			!window.confirm(
				isPublish
					? `Publicar a release ${release.version}?\nEla passa a ser a atualização disponível para TODOS os clientes.`
					: `Retirar a release ${release.version} do ar?\nEla deixa de aparecer para os clientes (deployments já atribuídos continuam).`,
			)
		)
			return;
		try {
			const res = isPublish
				? await firmwareService.publish(release.id)
				: await firmwareService.unpublish(release.id);
			toast.success((res as { message?: string }).message ?? 'Status atualizado');
			onChanged?.();
			router.refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Falha ao alterar o status');
		}
	}

	return (
		<>
			{release.status === 'draft' ? (
				<>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						title="Publicar — disponibilizar para todos os clientes"
						onClick={() => void flip('publish')}
					>
						<CloudUpload className="h-4 w-4 text-muted-foreground" />
					</Button>
					<FirmwareTestDialog release={release} />
				</>
			) : (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					title="Retirar do ar (emergência)"
					onClick={() => void flip('unpublish')}
				>
					<EyeOff className="h-4 w-4 text-muted-foreground" />
				</Button>
			)}
		</>
	);
}
