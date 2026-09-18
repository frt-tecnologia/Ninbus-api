'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { firmwareService, deviceService } from '@/lib/api';
import type { FirmwareRelease } from '@/types/domain';

/**
 * Factory test layer — push a (usually DRAFT) release to selected pilot
 * devices via the admin force deploy endpoint, with an explicit releaseId.
 * This is how the factory validates a release BEFORE publishing it.
 */
export function FirmwareTestDialog({
	release,
	open,
	onOpenChange,
}: {
	release: FirmwareRelease;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [devices, setDevices] = React.useState<Awaited<ReturnType<typeof deviceService.listAll>>['data']>([]);
	const [selected, setSelected] = React.useState<Set<string>>(new Set());
	const [query, setQuery] = React.useState('');
	const [loading, setLoading] = React.useState(false);
	const router = useRouter();

	async function load() {
		setLoading(true);
		try {
			const res = await deviceService.listAll();
			setDevices(res.data);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Falha ao carregar dispositivos');
		} finally {
			setLoading(false);
		}
	}

	React.useEffect(() => {
		if (open && devices.length === 0 && !loading) void load();
	}, [open]); // eslint-disable-line react-hooks/exhaustive-deps

	function toggle(id: string) {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	const filtered = devices.filter((d) =>
		`${d.name} ${d.serialDisplay ?? ''}`.toLowerCase().includes(query.toLowerCase()),
	);

	async function confirm() {
		setLoading(true);
		try {
			const res = await firmwareService.deploy([...selected], undefined, release.id);
			toast.success(
				(res as { message?: string }).message ?? `Teste agendado para ${selected.size} dispositivo(s)`,
			);
			onOpenChange(false);
			setSelected(new Set());
			router.refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Falha ao agendar o teste');
		} finally {
			setLoading(false);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<FlaskConical className="h-4 w-4" />
						Testar release {release.version}
					</DialogTitle>
					<DialogDescription>
						Envie esta release para dispositivos piloto antes de publicá-la. A atualização é
						forçada (instala no próximo contato) e não depende de aprovação do usuário.
					</DialogDescription>
				</DialogHeader>
				<Input
					placeholder="Buscar por nome ou serial…"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
				/>
				<ul className="max-h-64 space-y-1 overflow-auto rounded border p-2 text-sm">
					{loading && devices.length === 0 && (
						<li className="py-4 text-center text-muted-foreground">Carregando…</li>
					)}
					{filtered.map((d) => (
						<li key={d.id}>
							<label className="flex cursor-pointer items-center justify-between gap-2 rounded px-1 py-1 hover:bg-muted/50">
								<span className="flex items-center gap-2">
									<input
										type="checkbox"
										checked={selected.has(d.id)}
										onChange={() => toggle(d.id)}
										className="h-4 w-4"
									/>
									<span className="truncate font-medium">{d.name}</span>
								</span>
								<span className="font-mono text-xs text-muted-foreground">
									{d.firmwareVersion ?? '—'} → {release.version}
								</span>
							</label>
						</li>
					))}
					{!loading && filtered.length === 0 && (
						<li className="py-4 text-center text-muted-foreground">Nenhum dispositivo encontrado.</li>
					)}
				</ul>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
						Cancelar
					</Button>
					<Button onClick={confirm} disabled={loading || selected.size === 0}>
						{loading ? 'Enviando…' : `Testar em ${selected.size} dispositivo(s)`}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
