'use client';

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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { http } from '@/lib/api/http';
import { notifyDataChanged } from '@/lib/data-events';
import type { ActionResponse } from '@/types/domain';
import { Plus } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { GROUP_TYPE_LABELS, GroupTypeIcon } from './group-type-icon';

const TYPES = ['garage', 'bus_line', 'region', 'yard', 'custom'] as const;

/**
 * <GroupCreateDialog> — create a new device group (category) in a company.
 *
 * Opens via a trigger button. Posts to POST /companies/:id/categories. The
 * `defaultType` preselects the type (used by the per-card "+" buttons).
 */
export function GroupCreateDialog({
	companyId,
	defaultType = 'garage',
	onDone,
}: {
	companyId: string;
	defaultType?: string;
	onDone?: () => void;
}) {
	const [open, setOpen] = React.useState(false);
	const [name, setName] = React.useState('');
	const [type, setType] = React.useState<string>(defaultType);
	const [saving, setSaving] = React.useState(false);

	function openDialog() {
		setName('');
		setType(defaultType);
		setOpen(true);
	}

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		if (!name.trim()) return;
		setSaving(true);
		try {
			await http.post<ActionResponse>(`/companies/${companyId}/categories`, {
				name: name.trim(),
				type,
			});
			notifyDataChanged();
			toast.success('Grupo criado.');
			setOpen(false);
			onDone?.();
		} catch {
			toast.error('Falha ao criar o grupo.');
		} finally {
			setSaving(false);
		}
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<button
				type="button"
				onClick={openDialog}
				className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
				aria-label="Adicionar grupo"
				title="Adicionar grupo"
			>
				<Plus className="h-3.5 w-3.5" />
			</button>
			<DialogContent className="sm:max-w-md">
				<form onSubmit={submit}>
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<GroupTypeIcon type={type} className="h-4 w-4 text-muted-foreground" />
							Novo grupo
						</DialogTitle>
						<DialogDescription>
							Crie uma garagem, linha ou região para organizar dispositivos.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-3 py-3">
						<div className="space-y-1.5">
							<label htmlFor="group-type" className="text-xs font-medium text-foreground">Tipo</label>
							<Select value={type} onValueChange={setType}>
								<SelectTrigger id="group-type" className="h-8">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{TYPES.map((t) => (
										<SelectItem key={t} value={t}>
											{GROUP_TYPE_LABELS[t]}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1.5">
							<label htmlFor="group-name" className="text-xs font-medium text-foreground">Nome</label>
							<Input
								id="group-name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="Ex.: Garagem Central"
								className="h-8"
								autoFocus
							/>
						</div>
					</div>
					<DialogFooter>
						<Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
							Cancelar
						</Button>
						<Button type="submit" size="sm" disabled={saving || !name.trim()}>
							{saving ? 'Criando…' : 'Criar grupo'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
