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
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { firmwareService } from '@/lib/api';
import type { FirmwareArtifactType } from '@/types/domain';
import { UploadCloud } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

/**
 * Publish a factory firmware release. GOLDEN RULE (v4 device contract): the
 * device only accepts the canonical TAR signed by the Ninbus-v4 tools —
 * ota_sign.py + ota_pack.py (artifact.info + data/firmware.npm with the
 * signed NPM manifest). firmware-ninbus REQUIRES that .tar (stored verbatim;
 * the server never signs); firmware-controller also accepts a raw .fir.
 */
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function FirmwareUploadDialog({ onDone }: { onDone?: () => void }) {
	const [open, setOpen] = React.useState(false);
	const [loading, setLoading] = React.useState(false);
	const [file, setFile] = React.useState<File | null>(null);
	const [name, setName] = React.useState('');
	const [version, setVersion] = React.useState('');
	const [type, setType] = React.useState<FirmwareArtifactType>('firmware-ninbus');
	const [description, setDescription] = React.useState('');
	const router = useRouter();

	const versionValid = SEMVER_RE.test(version.trim());

	const reset = () => {
		setFile(null);
		setName('');
		setVersion('');
		setType('firmware-ninbus');
		setDescription('');
	};

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		if (!file || !name.trim() || !versionValid) return;
		setLoading(true);
		const err = await firmwareService
			.upload({
				file,
				name: name.trim(),
				version: version.trim(),
				artifactType: type,
				description: description.trim() || undefined,
			})
			.then(() => null)
			.catch((error: unknown) =>
				error instanceof Error ? error.message : 'Falha ao publicar firmware',
			);
		setLoading(false);
		if (err) {
			toast.error(err);
			return;
		}
		toast.success(`Rascunho ${version.trim()} criado — publique quando validar.`);
		setOpen(false);
		reset();
		router.refresh();
		onDone?.();
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
				<Button size="sm">
					<UploadCloud className="h-4 w-4" />
					Enviar firmware
				</Button>
			</DialogTrigger>
			<DialogContent>
				<form onSubmit={submit}>
					<DialogHeader>
						<DialogTitle>Enviar firmware</DialogTitle>
						<DialogDescription>
							Entra como rascunho — publique após validar em dispositivos piloto.
						</DialogDescription>
					</DialogHeader>
					<FieldGroup>
						<Field data-required>
							<FieldLabel htmlFor="fw-file">Arquivo</FieldLabel>
							<Input
								id="fw-file"
								type="file"
								accept=".tar,.fir,.frz,.bin"
								required
								onChange={(e) => setFile(e.target.files?.[0] ?? null)}
								className="cursor-pointer file:mr-3 file:cursor-pointer"
							/>
							<FieldDescription>
								Ninbus: TAR do ota_pack.py (assinado) — bin cru é rejeitado.
							</FieldDescription>
							{file && (
								<FieldDescription>
									{file.name} · {(file.size / 1024).toFixed(0)} KB
								</FieldDescription>
							)}
						</Field>
						<Field data-required>
							<FieldLabel htmlFor="fw-name">Nome</FieldLabel>
							<Input
								id="fw-name"
								placeholder="wifi3 — estabilidade CAN"
								maxLength={256}
								required
								value={name}
								onChange={(e) => setName(e.target.value)}
							/>
						</Field>
						<div className="grid gap-4 sm:grid-cols-2">
							<Field data-required data-invalid={version ? !versionValid : undefined}>
								<FieldLabel htmlFor="fw-version">Versão (semver)</FieldLabel>
								<Input
									id="fw-version"
									placeholder="4.0.1"
									maxLength={64}
									required
									value={version}
									onChange={(e) => setVersion(e.target.value)}
									aria-invalid={version ? !versionValid : undefined}
								/>
								{version && !versionValid && (
									<FieldDescription>Use o formato X.Y.Z (ex.: 4.0.1)</FieldDescription>
								)}
							</Field>
							<Field data-required>
								<FieldLabel htmlFor="fw-type">Tipo</FieldLabel>
								<Select value={type} onValueChange={(v) => setType(v as FirmwareArtifactType)}>
									<SelectTrigger id="fw-type">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="firmware-ninbus">Ninbus (reinicia)</SelectItem>
										<SelectItem value="firmware-controller">Controlador (CAN)</SelectItem>
									</SelectContent>
								</Select>
							</Field>
						</div>
						<Field>
							<FieldLabel htmlFor="fw-desc">Notas</FieldLabel>
							<Input
								id="fw-desc"
								placeholder="O que mudou nesta release"
								maxLength={1000}
								value={description}
								onChange={(e) => setDescription(e.target.value)}
							/>
						</Field>
					</FieldGroup>
					<DialogFooter className="mt-5">
						<Button type="button" variant="outline" onClick={() => setOpen(false)}>
							Cancelar
						</Button>
						<Button type="submit" disabled={loading || !file || !name.trim() || !versionValid}>
							{loading ? 'Enviando…' : 'Enviar'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
