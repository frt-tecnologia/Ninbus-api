'use client';

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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { useFetch } from '@/hooks/useFetch';
import { companyService, designationService } from '@/lib/api';
import { notifyDataChanged } from '@/lib/data-events';
import { UserPlus } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

const ROLES = [
	{ value: 'viewer', label: 'Visualizador' },
	{ value: 'operator', label: 'Operador' },
	{ value: 'admin', label: 'Administrador' },
	{ value: 'owner', label: 'Proprietário' },
] as const;

/**
 * <InviteUserDialog> — designates an email to a company via the API
 * (POST /companies/:id/members). If the user has no account yet, a PENDING
 * designation is created that activates on sign-up. Powers the "Adicionar
 * convite" button on the Users page.
 */
export function InviteUserDialog({ onDone }: { onDone?: () => void }) {
	const companies = useFetch(companyService.list);
	const [open, setOpen] = React.useState(false);
	const [companyId, setCompanyId] = React.useState('');
	const [email, setEmail] = React.useState('');
	const [role, setRole] = React.useState<string>('viewer');
	const [saving, setSaving] = React.useState(false);

	function reset() {
		setCompanyId('');
		setEmail('');
		setRole('viewer');
	}

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		if (!companyId || !email.trim()) return;
		setSaving(true);
		try {
			const res = await designationService.create(companyId, { email: email.trim(), role });
			notifyDataChanged();
			toast.success(res.message ?? 'Convite criado.');
			setOpen(false);
			reset();
			onDone?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Falha ao criar o convite.');
		} finally {
			setSaving(false);
		}
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(v) => {
				setOpen(v);
				if (!v) reset();
			}}
		>
			<DialogTrigger asChild>
				<Button size="sm" className="h-8 gap-1.5">
					<UserPlus className="h-3.5 w-3.5" />
					Adicionar convite
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<form onSubmit={submit}>
					<DialogHeader>
						<DialogTitle>Convidar usuário</DialogTitle>
						<DialogDescription>
							Designe um email a uma empresa. Se o usuário ainda não tem conta, ele ganhará acesso
							ao se cadastrar.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-3 py-3">
						<div className="space-y-1.5">
							<label htmlFor="invite-company" className="text-xs font-medium text-foreground">
								Empresa
							</label>
							<Select value={companyId} onValueChange={setCompanyId}>
								<SelectTrigger id="invite-company" className="h-8">
									<SelectValue placeholder="Selecione a empresa" />
								</SelectTrigger>
								<SelectContent>
									{(companies.data?.data ?? []).map((c) => (
										<SelectItem key={c.id} value={c.id}>
											{c.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1.5">
							<label htmlFor="invite-email" className="text-xs font-medium text-foreground">
								Email
							</label>
							<Input
								id="invite-email"
								type="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								placeholder="usuario@empresa.com.br"
								className="h-8"
								autoFocus
							/>
						</div>
						<div className="space-y-1.5">
							<label htmlFor="invite-role" className="text-xs font-medium text-foreground">
								Função
							</label>
							<Select value={role} onValueChange={setRole}>
								<SelectTrigger id="invite-role" className="h-8">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{ROLES.map((r) => (
										<SelectItem key={r.value} value={r.value}>
											{r.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
					<DialogFooter>
						<Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
							Cancelar
						</Button>
						<Button type="submit" size="sm" disabled={saving || !companyId || !email.trim()}>
							{saving ? 'Enviando…' : 'Criar convite'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
