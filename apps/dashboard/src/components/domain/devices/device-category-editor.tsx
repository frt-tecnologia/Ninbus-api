'use client';

import * as React from 'react';
import { Tags } from 'lucide-react';
import { toast } from 'sonner';
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
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { categoryService, deviceService } from '@/lib/api';
import { notifyDataChanged } from '@/lib/data-events';
import type { DeviceCategory } from '@/types/domain';

/**
 * <DeviceCategoryEditor> — assign device groups (garage / bus_line / region)
 * to a device via the N:N endpoint PUT /devices/:deviceId/categories.
 *
 * Loads the company's categories + the device's current assignments, presents
 * a checkbox list, and saves the full set on submit. On success it toasts,
 * notifies the global data bus (tables refresh), and calls onDone.
 */
export function DeviceCategoryEditor({
	companyId,
	deviceId,
	deviceName,
	onDone,
}: {
	companyId: string;
	deviceId: string;
	deviceName: string;
	onDone?: () => void;
}) {
	const [open, setOpen] = React.useState(false);
	const [allCats, setAllCats] = React.useState<DeviceCategory[]>([]);
	const [selected, setSelected] = React.useState<Set<string>>(new Set());
	const [loading, setLoading] = React.useState(true);
	const [saving, setSaving] = React.useState(false);

	async function load() {
		setLoading(true);
		try {
			const [cats, current] = await Promise.all([
				categoryService.listByCompany(companyId),
				deviceService.listCategories(companyId, deviceId),
			]);
			setAllCats(cats.data);
			setSelected(new Set(current.data.map((c) => c.id)));
		} catch (err) {
			toast.error('Falha ao carregar grupos do dispositivo.');
		} finally {
			setLoading(false);
		}
	}

	React.useEffect(() => {
		if (open) void load();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);

	async function save() {
		setSaving(true);
		try {
			await deviceService.assignCategories(companyId, deviceId, [...selected]);
			notifyDataChanged();
			toast.success('Grupos do dispositivo atualizados.');
			setOpen(false);
			onDone?.();
		} catch (err) {
			toast.error('Falha ao salvar os grupos.');
		} finally {
			setSaving(false);
		}
	}

	const toggle = (id: string) =>
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
					<Tags className="h-3.5 w-3.5" />
					Grupos
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Grupos do dispositivo</DialogTitle>
					<DialogDescription className="truncate">
						Atribua garagens, linhas e regiões a {deviceName}.
					</DialogDescription>
				</DialogHeader>

				{loading ? (
					<p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>
				) : allCats.length === 0 ? (
					<p className="py-8 text-center text-sm text-muted-foreground">
						Nenhum grupo criado nesta empresa.
					</p>
				) : (
					<ScrollArea className="max-h-72 rounded-md border border-border p-1">
						<ul className="space-y-0.5">
							{allCats.map((c) => (
								<li key={c.id}>
									<label className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-sm hover:bg-secondary/60">
										<Checkbox
											checked={selected.has(c.id)}
											onCheckedChange={() => toggle(c.id)}
										/>
										<span className="flex-1">{c.name}</span>
										<span className="font-mono text-[10px] text-muted-foreground">{c.type}</span>
									</label>
								</li>
							))}
						</ul>
					</ScrollArea>
				)}

				<DialogFooter>
					<Button variant="outline" size="sm" onClick={() => setOpen(false)}>
						Cancelar
					</Button>
					<Button size="sm" onClick={save} disabled={saving || loading}>
						{saving ? 'Salvando…' : 'Salvar'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
