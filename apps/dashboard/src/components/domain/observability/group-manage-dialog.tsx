'use client';

import { SearchField, Signal } from '@/components/system';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { categoryService, deviceService } from '@/lib/api';
import type { AggregatedCategory } from '@/lib/api/observability';
import { notifyDataChanged } from '@/lib/data-events';
import { connectionSignal, deviceSignal } from '@/lib/design/tokens';
import type { Device } from '@/types/domain';
import { Trash2 } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { GROUP_TYPE_LABELS, GroupTypeIcon } from './group-type-icon';

/**
 * <GroupManageDialog> — full CRUD for a device group (category).
 *
 * 3 capabilities:
 *  1. Rename the group (PUT /categories/:id)
 *  2. Delete the group (DELETE /categories/:id)
 *  3. Manage member devices — loads ALL company devices, shows checkboxes
 *     reflecting current membership, with a SEARCH BAR (name/serial filter).
 *     Toggling add/remove via the N:N member endpoints.
 */
export function GroupManageDialog({
	companyId,
	category,
	open,
	onOpenChange,
}: {
	companyId: string;
	category: AggregatedCategory | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [name, setName] = React.useState('');
	const [allDevices, setAllDevices] = React.useState<Device[]>([]);
	const [memberIds, setMemberIds] = React.useState<Set<string>>(new Set());
	const [search, setSearch] = React.useState('');
	const [loading, setLoading] = React.useState(true);
	const [savingName, setSavingName] = React.useState(false);
	const [deleting, setDeleting] = React.useState(false);
	const [busyDevice, setBusyDevice] = React.useState<string | null>(null);

	// Load ALL company devices + current membership when opening.
	React.useEffect(() => {
		if (!open || !category) return;
		setName(category.name);
		setSearch('');
		setLoading(true);
		(async () => {
			try {
				const [devs, mem] = await Promise.all([
					deviceService.listByCompany(companyId),
					categoryService.listMembers(companyId, category.id),
				]);
				setAllDevices(devs.data);
				setMemberIds(new Set(mem.data.map((d) => d.id)));
			} catch {
				toast.error('Falha ao carregar o grupo.');
			} finally {
				setLoading(false);
			}
		})();
	}, [open, category, companyId]);

	// Filter all devices by search term (name or serial).
	const filtered = React.useMemo(() => {
		const term = search.trim().toLowerCase();
		if (!term) return allDevices;
		return allDevices.filter((d) =>
			[d.name, d.serialNumber, d.serialDisplay, d.hawkbitTargetId].some((v) =>
				(v ?? '').toLowerCase().includes(term),
			),
		);
	}, [allDevices, search]);

	async function saveName() {
		if (!category || !name.trim()) return;
		setSavingName(true);
		try {
			await categoryService.rename(companyId, category.id, name.trim());
			notifyDataChanged();
			toast.success('Nome do grupo atualizado.');
		} catch {
			toast.error('Falha ao renomear o grupo.');
		} finally {
			setSavingName(false);
		}
	}

	async function toggleDevice(device: Device) {
		if (!category) return;
		const wasMember = memberIds.has(device.id);
		setBusyDevice(device.id);
		try {
			if (wasMember) {
				await categoryService.removeMember(companyId, category.id, device.id);
			} else {
				await categoryService.addMembers(companyId, category.id, [device.id]);
			}
			setMemberIds((prev) => {
				const next = new Set(prev);
				if (wasMember) next.delete(device.id);
				else next.add(device.id);
				return next;
			});
			notifyDataChanged();
		} catch {
			toast.error('Falha ao atualizar membro do grupo.');
		} finally {
			setBusyDevice(null);
		}
	}

	async function removeGroup() {
		if (!category) return;
		if (!confirm(`Excluir o grupo "${category.name}"? Esta ação não pode ser desfeita.`)) return;
		setDeleting(true);
		try {
			await categoryService.remove(companyId, category.id);
			notifyDataChanged();
			toast.success('Grupo excluído.');
			onOpenChange(false);
		} catch {
			toast.error('Falha ao excluir o grupo.');
		} finally {
			setDeleting(false);
		}
	}

	if (!category) return null;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<GroupTypeIcon type={category.type} className="h-4 w-4 text-muted-foreground" />
						{category.name}
						<span className="ml-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
							{GROUP_TYPE_LABELS[category.type] ?? category.type}
						</span>
					</DialogTitle>
					<DialogDescription>
						Gerencie o nome, a exclusão e os dispositivos deste grupo.
					</DialogDescription>
				</DialogHeader>

				{/* Rename */}
				<div className="space-y-1.5">
					<label className="text-xs font-medium text-foreground">Nome do grupo</label>
					<div className="flex gap-2">
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							className="h-8"
							placeholder="Nome do grupo"
						/>
						<Button
							size="sm"
							onClick={saveName}
							disabled={savingName || !name.trim() || name.trim() === category.name}
							className="h-8 shrink-0"
						>
							{savingName ? '…' : 'Salvar'}
						</Button>
					</div>
				</div>

				{/* Devices with search */}
				<div className="space-y-1.5">
					<div className="flex items-center justify-between">
						<label className="text-xs font-medium text-foreground">
							Dispositivos
							{!loading && (
								<span className="ml-1.5 text-muted-foreground">
									({memberIds.size} no grupo · {allDevices.length} total)
								</span>
							)}
						</label>
					</div>
					{!loading && allDevices.length > 0 && (
						<SearchField
							value={search}
							onChange={setSearch}
							placeholder="Buscar por nome ou serial…"
							autoFocus
						/>
					)}
					<ScrollArea className="max-h-64 rounded-md border border-border">
						{loading ? (
							<p className="p-4 text-center text-xs text-muted-foreground">Carregando…</p>
						) : filtered.length === 0 ? (
							<p className="p-4 text-center text-xs text-muted-foreground">
								{allDevices.length === 0
									? 'Nenhum dispositivo nesta empresa.'
									: 'Nenhum dispositivo encontrado para a busca.'}
							</p>
						) : (
							<ul className="divide-y divide-border">
								{filtered.map((d) => {
									const checked = memberIds.has(d.id);
									return (
										<li key={d.id}>
											<label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-secondary/60">
												<Checkbox
													checked={checked}
													disabled={busyDevice === d.id}
													onCheckedChange={() => toggleDevice(d)}
												/>
												<div className="min-w-0 flex-1">
													<div className="truncate text-xs font-medium text-foreground">
														{d.name}
													</div>
													<div className="truncate font-mono text-[10px] text-muted-foreground">
														{d.serialDisplay ?? d.serialNumber ?? d.hawkbitTargetId ?? '—'}
													</div>
												</div>
												<div className="flex items-center gap-2">
													<Signal
														token={connectionSignal(d.connectionStatus)}
														glyphOnly
														size="sm"
													/>
													<Signal token={deviceSignal(d.status)} glyphOnly size="sm" />
												</div>
											</label>
										</li>
									);
								})}
							</ul>
						)}
					</ScrollArea>
				</div>

				{/* Delete (footer) */}
				<div className="flex justify-end border-t border-border pt-3">
					<Button
						variant="destructive"
						size="sm"
						onClick={removeGroup}
						disabled={deleting}
						className="gap-1.5"
					>
						<Trash2 className="h-3.5 w-3.5" />
						{deleting ? 'Excluindo…' : 'Excluir grupo'}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
