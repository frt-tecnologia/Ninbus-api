'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, RefreshCw } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Field } from '@/components/system';
import { deviceService } from '@/lib/api';
import { notifyDataChanged } from '@/lib/data-events';

/**
 * Provision a device by serial + factory key. On success, toasts + refreshes
 * the route so server data reloads. Server-validated; we surface the message.
 */
export function ProvisionDialog({ onDone }: { onDone?: () => void }) {
	const [open, setOpen] = React.useState(false);
	const [loading, setLoading] = React.useState(false);
	const [serial, setSerial] = React.useState('');
	const [deviceKey, setDeviceKey] = React.useState('');
	const [name, setName] = React.useState('');
	const router = useRouter();

	const reset = () => {
		setSerial('');
		setDeviceKey('');
		setName('');
	};

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		setLoading(true);
		const res = await deviceService
			.provision({ serialNumber: serial.trim(), deviceKey: deviceKey.trim(), name: name.trim() || undefined })
			.then(() => null)
			.catch((err: unknown) => (err instanceof Error ? err.message : 'Falha ao provisionar'));
		setLoading(false);
		if (res) {
			toast.error(res);
			return;
		}
		toast.success('Dispositivo provisionado.');
		setOpen(false);
		reset();
		notifyDataChanged();
		router.refresh();
		onDone?.();
	}

	return (
		<Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
			<DialogTrigger asChild>
				<Button size="sm">
					<Plus className="h-4 w-4" />
					Cadastrar dispositivo
				</Button>
			</DialogTrigger>
			<DialogContent>
				<form onSubmit={submit}>
					<DialogHeader>
						<DialogTitle>Provisionar dispositivo</DialogTitle>
						<DialogDescription>
							Registra o dispositivo na plataforma e cria o alvo no hawkBit pelo
							número de série + chave de fábrica.
						</DialogDescription>
					</DialogHeader>
					<div className="mt-4 flex flex-col gap-4">
						<Field label="Número de série" htmlFor="serial" required>
							<Input
								id="serial"
								required
								value={serial}
								onChange={(e) => setSerial(e.target.value)}
								placeholder="SN-0001"
								className="font-mono"
								autoComplete="off"
							/>
						</Field>
						<Field label="Chave de fábrica (device key)" htmlFor="dkey" required hint="Gravada no firmware do dispositivo.">
							<Input
								id="dkey"
								required
								value={deviceKey}
								onChange={(e) => setDeviceKey(e.target.value)}
								placeholder="••••••••••••"
								className="font-mono"
								autoComplete="off"
							/>
						</Field>
						<Field label="Nome (opcional)" htmlFor="dname">
							<Input
								id="dname"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="Linha A — Robô 12"
								autoComplete="off"
							/>
						</Field>
					</div>
					<DialogFooter className="mt-6">
						<Button type="button" variant="ghost" onClick={() => setOpen(false)}>
							Cancelar
						</Button>
						<Button type="submit" disabled={loading}>
							{loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
							Provisionar
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
