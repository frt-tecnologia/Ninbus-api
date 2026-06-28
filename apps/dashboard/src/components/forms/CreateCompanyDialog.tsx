'use client';

import { useState, type FormEvent } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';
import { useMutation } from '@/hooks/useFetch';
import { companyService } from '@/lib/api';

/**
 * CreateCompanyDialog — precadastro de empresa + designação do owner por email.
 * Se o owner ainda não tem conta, vira designação pendente (resolvida no sign-up).
 */
export function CreateCompanyDialog({
	open,
	onClose,
	onCreated,
}: {
	open: boolean;
	onClose: () => void;
	onCreated: () => void;
}) {
	const [name, setName] = useState('');
	const [ownerEmail, setOwnerEmail] = useState('');

	const { run, loading, error, clearError } = useMutation(
		async (n: string, e: string) => companyService.create({ name: n, ownerEmail: e }),
	);

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		const result = await run(name, ownerEmail);
		if (result) {
			setName('');
			setOwnerEmail('');
			clearError();
			onCreated();
			onClose();
		}
	}

	return (
		<Modal
			open={open}
			onClose={onClose}
			title="Precadastrar empresa"
			description="Cria a empresa e designa o dono por email. Se ele ainda não tem conta, a designação fica pendente até o registro."
			footer={
				<>
					<Button variant="outline" onClick={onClose} disabled={loading}>
						Cancelar
					</Button>
					<Button type="submit" form="create-company-form" loading={loading}>
						Criar
					</Button>
				</>
			}
		>
			<form id="create-company-form" onSubmit={handleSubmit} className="space-y-4">
				<Field label="Nome da empresa" htmlFor="name" error={error ?? undefined}>
					<Input
						id="name"
						required
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Ex.: Viação Exemplo LTDA"
					/>
				</Field>
				<Field
					label="Email do dono"
					htmlFor="ownerEmail"
					hint="Será adicionado como owner (ou designação pendente se não tiver conta)"
				>
					<Input
						id="ownerEmail"
						type="email"
						required
						value={ownerEmail}
						onChange={(e) => setOwnerEmail(e.target.value)}
						placeholder="dono@empresa.com"
					/>
				</Field>
			</form>
		</Modal>
	);
}
