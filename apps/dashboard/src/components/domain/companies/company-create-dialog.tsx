'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
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
import { companyService } from '@/lib/api';
import { notifyDataChanged } from '@/lib/data-events';

export function CompanyCreateDialog({ onDone }: { onDone?: () => void }) {
	const [open, setOpen] = React.useState(false);
	const [loading, setLoading] = React.useState(false);
	const [name, setName] = React.useState('');
	const [ownerEmail, setOwnerEmail] = React.useState('');
	const router = useRouter();

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		setLoading(true);
		const err = await companyService
			.create({ name: name.trim(), ownerEmail: ownerEmail.trim() })
			.then(() => null)
			.catch((e: unknown) => (e instanceof Error ? e.message : 'Falha ao criar empresa'));
		setLoading(false);
		if (err) {
			toast.error(err);
			return;
		}
		toast.success('Empresa criada e owner designado.');
		setOpen(false);
		setName('');
		setOwnerEmail('');
		notifyDataChanged();
		router.refresh();
		onDone?.();
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button size="sm">
					<Plus className="h-4 w-4" />
					Nova empresa
				</Button>
			</DialogTrigger>
			<DialogContent>
				<form onSubmit={submit}>
					<DialogHeader>
						<DialogTitle>Precadastrar empresa</DialogTitle>
						<DialogDescription>
							Cria a empresa e designa o owner por email. O owner recebe acesso
							ao se registrar com esse email.
						</DialogDescription>
					</DialogHeader>
					<div className="mt-4 flex flex-col gap-4">
						<Field label="Nome da empresa" htmlFor="cname" required>
							<Input
								id="cname"
								required
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="Acme Indústria"
							/>
						</Field>
						<Field label="Email do owner" htmlFor="cowner" required hint="Será designado como proprietário da empresa.">
							<Input
								id="cowner"
								type="email"
								required
								value={ownerEmail}
								onChange={(e) => setOwnerEmail(e.target.value)}
								placeholder="owner@acme.com"
							/>
						</Field>
					</div>
					<DialogFooter className="mt-6">
						<Button type="button" variant="ghost" onClick={() => setOpen(false)}>
							Cancelar
						</Button>
						<Button type="submit" disabled={loading}>
							Criar empresa
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
