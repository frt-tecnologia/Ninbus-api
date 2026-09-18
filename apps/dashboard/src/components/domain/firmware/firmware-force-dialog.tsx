'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Rocket } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { firmwareService } from '@/lib/api';
import type { Device } from '@/types/domain';

export interface FirmwareForceTarget {
	id: string;
	name: string;
	serialDisplay?: string | null;
	firmwareVersion?: string | null;
}

/**
 * Force firmware update (console path): the factory pushes the latest
 * release to selected devices WITHOUT end-user interaction. hawkBit
 * deployments are download/update FORCED — devices install on their next
 * DDI poll. Each company gets its own deployment.
 *
 * Two modes:
 *  - controlled (open/onOpenChange): opened by table cells
 *  - trigger: renders its own button (detail pages)
 */
export function FirmwareForceDialog({
	open,
	onOpenChange,
	trigger,
	devices,
	targetVersion,
	releaseId,
	onDone,
}: {
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	trigger?: boolean;
	devices: FirmwareForceTarget[];
	targetVersion: string | null;
	/** Explicit release (any status — lets the factory TEST a draft on pilots). */
	releaseId?: string;
	onDone?: () => void;
}) {
	const [loading, setLoading] = React.useState(false);
	const router = useRouter();

	async function confirm() {
		setLoading(true);
		try {
			const res = await firmwareService.deploy(
				devices.map((d) => d.id),
				undefined,
				releaseId,
			);
			toast.success((res as { message?: string }).message ?? 'Atualização forçada agendada');
			onOpenChange?.(false);
			onDone?.();
			router.refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Falha ao forçar a atualização');
		} finally {
			setLoading(false);
		}
	}

	const body = (
		<DialogContent>
			<DialogHeader>
				<DialogTitle className="flex items-center gap-2">
					<Rocket className="h-4 w-4" />
					Forçar atualização de firmware
				</DialogTitle>
				<DialogDescription>
					{targetVersion
						? `A release ${targetVersion} será enviada agora aos dispositivos abaixo, sem interação do usuário. Cada dispositivo instala no próximo contato com o servidor.`
						: 'A última release publicada será enviada agora aos dispositivos abaixo, sem interação do usuário.'}
				</DialogDescription>
			</DialogHeader>
			<ul className="max-h-56 space-y-1 overflow-auto rounded border p-2 text-sm">
				{devices.map((d) => (
					<li key={d.id} className="flex items-center justify-between gap-2">
						<span className="truncate font-medium">{d.name}</span>
						<Badge variant="outline" className="shrink-0 font-mono text-xs">
							{d.firmwareVersion ?? '—'} → {targetVersion ?? '?'}
						</Badge>
					</li>
				))}
			</ul>
			<DialogFooter>
				<Button variant="outline" onClick={() => onOpenChange?.(false)} disabled={loading}>
					Cancelar
				</Button>
				<Button onClick={confirm} disabled={loading || devices.length === 0}>
					{loading ? 'Enviando…' : `Forçar para ${devices.length} dispositivo(s)`}
				</Button>
			</DialogFooter>
		</DialogContent>
	);

	if (trigger) {
		return (
			<Dialog>
				<DialogTrigger asChild>
					<Button size="sm" variant="destructive" className="gap-1.5">
						<Rocket />
						Forçar atualização
					</Button>
				</DialogTrigger>
				{body}
			</Dialog>
		);
	}
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			{body}
		</Dialog>
	);
}

/**
 * Firmware cell with an inline FORCE action: when the device is outdated,
 * the version badge becomes a button that opens the force-update dialog.
 */
export function FirmwareForceCell({
	device,
	targetVersion,
	onDone,
}: {
	device: Device;
	targetVersion: string | null;
	onDone?: () => void;
}) {
	const [open, setOpen] = React.useState(false);

	return (
		<>
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						onClick={() => setOpen(true)}
						className="inline-flex items-center gap-1 rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 font-mono text-xs text-destructive transition-colors hover:bg-destructive/20"
						title="Forçar atualização de firmware"
					>
						<Rocket className="h-3 w-3" />
						{device.firmwareVersion ?? '—'}
					</button>
				</TooltipTrigger>
				<TooltipContent>Forçar atualização para {targetVersion ?? 'a última release'}</TooltipContent>
			</Tooltip>
			<FirmwareForceDialog
				open={open}
				onOpenChange={setOpen}
				devices={[
					{
						id: device.id,
						name: device.name,
						serialDisplay: device.serialDisplay,
						firmwareVersion: device.firmwareVersion,
					},
				]}
				targetVersion={targetVersion}
				onDone={onDone}
			/>
		</>
	);
}
