'use client';
/**
 * Forms — the reference's forms, wired to REAL endpoints. Every submit path
 * awaits the server; success is only shown after confirmation.
 *
 * - CompanyForm      → companyService.create {name, ownerEmail}
 * - GroupForm        → POST /companies/:id/categories
 * - RegisterForm     → provision (+ claim + group when chosen)
 * - AssignForm       → claim by serial (cross-company) + assignCategories
 * - MemberForm       → memberService.add {email, role}
 * - ReleaseForm      → POST /admin/firmware (multipart, XHR real progress)
 * - RolloutForm      → firmwareService.deploy(deviceIds, type, releaseId)
 */
import { Send } from 'lucide-react';
import { type FormEvent, useCallback, useState } from 'react';
import { toast } from 'sonner';
import {
	FileDropzone,
	type FileDropzoneUpload,
} from '@/components/arc/file-dropzone/file-dropzone';
import { Input } from '@/components/arc/input/input';
import { MorphSelect } from '@/components/arc/morph-select/morph-select';
import { PasswordField } from '@/components/arc/password-field/password-field';
import { RadioGroup } from '@/components/arc/radio-group/radio-group';
import {
	categoryService,
	companyService,
	deviceService,
	firmwareService,
	memberService,
} from '@/lib/api';
import type { Company, Device, FirmwareRelease } from '@/types/domain';
import s from './app.module.css';
import {
	Alert,
	type AnyRow,
	Button,
	Collection,
	kindOptions,
	roleOptions,
	SafeAction,
} from './primitives';

// ── shared bits ────────────────────────────────────────────────────────

function CompanyPicker({
	companies,
	value,
	onChange,
}: {
	companies: Company[];
	value: string;
	onChange: (v: string) => void;
}) {
	return (
		<MorphSelect
			label="Empresa"
			value={value || null}
			onValueChange={onChange}
			searchable
			searchPlaceholder="Pesquisar empresa"
			placeholder="Escolha a empresa"
			items={companies
				.filter((c) => c.status === 'active')
				.map((c) => ({ value: c.id, label: c.name, meta: `${c.deviceCount} dispositivos` }))}
		/>
	);
}

function Feedback({ error, success }: { error: string; success: string }) {
	return (
		<>
			{error && <Alert tone="danger" title={error} />}
			{success && <Alert tone="success" title={success} />}
		</>
	);
}

const _required = (v: string) => (v.trim() ? null : 'O nome não pode ficar vazio.');

function emitDataChanged() {
	import('@/lib/data-events').then(({ notifyDataChanged }) => notifyDataChanged());
}

// ── company ────────────────────────────────────────────────────────────

export function CompanyForm({ done }: { done: () => void }) {
	const [name, setName] = useState('');
	const [ownerEmail, setOwnerEmail] = useState('');
	const [error, setError] = useState('');
	const [success, setSuccess] = useState('');
	const [saving, setSaving] = useState(false);

	async function submit(e: FormEvent) {
		e.preventDefault();
		setError('');
		setSaving(true);
		try {
			await companyService.create({
				name: name.trim(),
				ownerEmail: ownerEmail.trim().toLowerCase(),
			});
			setSuccess(
				'Empresa criada e convite de proprietário registrado. O acesso é ativado no primeiro acesso do e-mail.',
			);
			emitDataChanged();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Falha ao criar a empresa.');
		} finally {
			setSaving(false);
		}
	}

	return (
		<form className={s.formStack} onSubmit={submit}>
			<Input
				label="Nome da empresa"
				required
				value={name}
				onChange={(e) => setName(e.target.value)}
			/>
			<Input
				label="E-mail do proprietário"
				type="email"
				required
				value={ownerEmail}
				onChange={(e) => setOwnerEmail(e.target.value)}
				description="Recebe o papel de proprietário. Se a conta não existir, o vínculo fica pendente até o cadastro."
			/>
			<Button type="submit" loading={saving} disabled={!!success}>
				Criar empresa
			</Button>
			<Feedback error={error} success={success} />
			{success && (
				<Button variant="secondary" type="button" onClick={done}>
					Concluir
				</Button>
			)}
		</form>
	);
}

// ── group ──────────────────────────────────────────────────────────────

export function GroupForm({
	companies,
	companyId: initialCompany,
	done,
}: {
	companies: Company[];
	companyId?: string;
	done: () => void;
}) {
	const [company, setCompany] = useState(initialCompany ?? '');
	const [name, setName] = useState('');
	const [description, setDescription] = useState('');
	const [type, setType] = useState('bus_line');
	const [error, setError] = useState('');
	const [success, setSuccess] = useState('');
	const [saving, setSaving] = useState(false);

	async function submit(e: FormEvent) {
		e.preventDefault();
		setError('');
		setSaving(true);
		try {
			const { http } = await import('@/lib/api');
			await http.post(`/companies/${company}/categories`, {
				name: name.trim(),
				type,
				...(description.trim() ? { description: description.trim() } : {}),
			});
			setSuccess('Grupo criado.');
			emitDataChanged();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Falha ao criar o grupo.');
		} finally {
			setSaving(false);
		}
	}

	return (
		<form className={s.formStack} onSubmit={submit}>
			<CompanyPicker companies={companies} value={company} onChange={setCompany} />
			<Input
				label="Nome do grupo"
				required
				value={name}
				onChange={(e) => setName(e.target.value)}
			/>
			<Input
				label="Descrição"
				value={description}
				onChange={(e) => setDescription(e.target.value)}
				placeholder="Explique o propósito e a responsabilidade"
			/>
			<RadioGroup
				label="Tipo do grupo"
				value={type}
				onValueChange={setType}
				options={[
					{ value: 'bus_line', label: 'Linha de ônibus' },
					{ value: 'garage', label: 'Garagem' },
					{ value: 'region', label: 'Região' },
					{ value: 'custom', label: 'Personalizado' },
				]}
			/>
			<Button type="submit" loading={saving} disabled={!!success || !company}>
				Criar grupo
			</Button>
			<Feedback error={error} success={success} />
			{success && (
				<Button variant="secondary" type="button" onClick={done}>
					Concluir
				</Button>
			)}
		</form>
	);
}

// ── register device (provision + optional claim/group) ─────────────────

export function RegisterForm({
	companies,
	groupsByCompany,
	companyId: initialCompany,
	done,
}: {
	companies: Company[];
	groupsByCompany: (
		companyId: string,
	) => { id: string; name: string; description: string | null }[];
	companyId?: string;
	done: () => void;
}) {
	const [serial, setSerial] = useState('');
	const [key, setKey] = useState('');
	const [name, setName] = useState('');
	const [company, setCompany] = useState(initialCompany ?? '');
	const [group, setGroup] = useState('');
	const [error, setError] = useState('');
	const [success, setSuccess] = useState('');
	const [saving, setSaving] = useState(false);

	async function submit(e: FormEvent) {
		e.preventDefault();
		setError('');
		setSaving(true);
		try {
			await deviceService.provision({
				serialNumber: serial.trim(),
				deviceKey: key.trim(),
				...(name.trim() ? { name: name.trim() } : {}),
			});
			let note = 'Dispositivo registrado na fábrica.';
			if (company) {
				await deviceService.claim(company, {
					serialNumber: serial.trim(),
					...(name.trim() ? { name: name.trim() } : {}),
				});
				note += ' Vinculado à empresa.';
				if (group) {
					const devices = await deviceService.listByCompany(company);
					const claimed = devices.data.find((d) => d.serialNumber === serial.trim());
					if (claimed) {
						await deviceService.assignCategories(company, claimed.id, [group]);
						note += ' Adicionado ao grupo.';
					}
				}
			}
			setKey('');
			setSuccess(note);
			emitDataChanged();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Falha ao registrar o dispositivo.');
		} finally {
			setSaving(false);
		}
	}

	return (
		<form className={s.formStack} onSubmit={submit}>
			<Input
				label="Número de série*"
				value={serial}
				onChange={(e) => setSerial(e.target.value)}
				required
				placeholder="ODA-26001001"
			/>
			<PasswordField
				label="Chave de fábrica (device key)*"
				value={key}
				onChange={(e) => setKey(e.target.value)}
				required
				autoComplete="off"
				description="Gravada no firmware do dispositivo. Nunca é armazenada pela API."
				messages={{ showPassword: 'Mostrar chave', hidePassword: 'Ocultar chave' }}
			/>
			<Input
				label="Nome (opcional)"
				value={name}
				onChange={(e) => setName(e.target.value)}
				placeholder="Validador 4101"
			/>
			<CompanyPicker
				companies={companies}
				value={company}
				onChange={(v) => {
					setCompany(v);
					setGroup('');
				}}
			/>
			{company && (
				<MorphSelect
					label="Grupo (opcional)"
					value={group || null}
					onValueChange={setGroup}
					searchable
					items={groupsByCompany(company).map((g) => ({
						value: g.id,
						label: g.name,
						meta: g.description ?? undefined,
					}))}
				/>
			)}
			<Button type="submit" loading={saving} disabled={!!success}>
				Registrar dispositivo
			</Button>
			<Feedback error={error} success={success} />
			{success && (
				<Button variant="secondary" type="button" onClick={done}>
					Concluir
				</Button>
			)}
		</form>
	);
}

// ── assign devices (claim + groups) ────────────────────────────────────

export function AssignForm({
	companies,
	devices,
	groupsByCompany,
	companyId: initialCompany,
	deviceIds: preselected,
	done,
}: {
	companies: Company[];
	devices: Device[];
	groupsByCompany: (
		companyId: string,
	) => { id: string; name: string; description: string | null }[];
	companyId?: string;
	deviceIds?: string[];
	done: () => void;
}) {
	const [company, setCompany] = useState(initialCompany ?? '');
	const [group, setGroup] = useState('');
	const [selected, setSelected] = useState<string[]>(preselected ?? []);
	const [error, setError] = useState('');

	const candidates: AnyRow[] = devices.map((dev) => ({
		...dev,
		companyName: companies.find((c) => c.id === dev.companyId)?.name ?? 'Sem empresa',
	}));

	async function assign() {
		setError('');
		try {
			const chosen = devices.filter((d) => selected.includes(d.id));
			for (const d of chosen) {
				if (d.companyId !== company && d.serialNumber) {
					await deviceService.claim(company, { serialNumber: d.serialNumber, name: d.name });
				}
			}
			if (group) {
				await categoryService.addMembers(company, group, selected);
			}
			toast.success(`${selected.length} dispositivo(s) atualizados.`);
			emitDataChanged();
			done();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Falha ao vincular dispositivos.');
		}
	}

	return (
		<div className={s.formStack}>
			<CompanyPicker
				companies={companies}
				value={company}
				onChange={(v) => {
					setCompany(v);
					setGroup('');
				}}
			/>
			<MorphSelect
				label="Adicionar ao grupo (opcional)"
				value={group || null}
				onValueChange={setGroup}
				searchable
				placeholder="Somente vincular à empresa"
				items={[
					{ value: '', label: 'Somente empresa' },
					...groupsByCompany(company).map((g) => ({
						value: g.id,
						label: g.name,
						meta: g.description ?? undefined,
					})),
				]}
			/>
			<Collection
				label="Dispositivos para vincular"
				rows={candidates}
				columns={[
					{ key: 'name', label: 'Dispositivo' },
					{ key: 'serialNumber', label: 'Número de série' },
					{ key: 'companyName', label: 'Empresa atual' },
				]}
				fields={[
					{
						id: 'companyName',
						label: 'Empresa atual',
						options: ['Sem empresa', ...companies.map((c) => c.name)],
					},
				]}
				selectable
				selected={selected}
				onSelectionChange={setSelected}
			/>
			<SafeAction
				label="vincular dispositivos"
				disabled={!company || !selected.length}
				description={`${selected.length} dispositivo(s) selecionado(s). Transferir de empresa desvincula a anterior. O grupo escolhido é adicionado aos vínculos existentes.`}
				onConfirm={assign}
			/>
			{error && <Alert tone="danger" title={error} />}
			<Button variant="ghost" onClick={done}>
				Fechar
			</Button>
		</div>
	);
}

// ── member / invite ────────────────────────────────────────────────────

export function MemberForm({
	companies,
	companyId: initialCompany,
	done,
}: {
	companies: Company[];
	companyId?: string;
	done: () => void;
}) {
	const [company, setCompany] = useState(initialCompany ?? '');
	const [email, setEmail] = useState('');
	const [role, setRole] = useState('operator');
	const [error, setError] = useState('');
	const [success, setSuccess] = useState('');
	const [saving, setSaving] = useState(false);

	async function submit(e: FormEvent) {
		e.preventDefault();
		setError('');
		setSaving(true);
		try {
			await memberService.add(company, { email: email.trim().toLowerCase(), role: role as never });
			setSuccess('Vínculo salvo. Se a conta não existir, o convite fica pendente até o cadastro.');
			emitDataChanged();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Falha ao adicionar a pessoa.');
		} finally {
			setSaving(false);
		}
	}

	return (
		<form className={s.formStack} onSubmit={submit}>
			<CompanyPicker companies={companies} value={company} onChange={setCompany} />
			<Input
				label="E-mail"
				type="email"
				required
				value={email}
				onChange={(e) => setEmail(e.target.value)}
			/>
			<RadioGroup
				label="Papel na empresa"
				value={role}
				onValueChange={setRole}
				options={roleOptions}
			/>
			<Button type="submit" loading={saving} disabled={!!success || !company}>
				<Send size={17} />
				Adicionar pessoa
			</Button>
			<Feedback error={error} success={success} />
			{success && (
				<Button type="button" variant="secondary" onClick={done}>
					Concluir
				</Button>
			)}
		</form>
	);
}

// ── release upload (real multipart + progress) ─────────────────────────

export function ReleaseForm({ done }: { done: () => void }) {
	const [name, setName] = useState('');
	const [version, setVersion] = useState('');
	const [description, setDescription] = useState('');
	const [type, setType] = useState(kindOptions[0]!.value);
	const [receipt, setReceipt] = useState<{ name: string; size: number } | null>(null);
	const [phase, setPhase] = useState('');
	const [selection, setSelection] = useState<File[]>([]);

	const upload: FileDropzoneUpload = useCallback(
		(item, { onProgress, signal }) =>
			new Promise<void>((resolve, reject) => {
				const file = item.file;
				if (!file) {
					reject(new Error('Arquivo indisponível. Selecione novamente.'));
					return;
				}
				setReceipt(null);
				setPhase('Enviando arquivo...');
				const xhr = new XMLHttpRequest();
				xhr.open('POST', '/console/api/admin/firmware');
				xhr.timeout = 120000;
				xhr.upload.onprogress = (e) => {
					if (e.lengthComputable) {
						onProgress(Math.min(99, (e.loaded / e.total) * 100));
						if (e.loaded === e.total) setPhase('Aguardando confirmação do servidor...');
					}
				};
				const abort = () => xhr.abort();
				signal.addEventListener('abort', abort, { once: true });
				const cleanup = () => signal.removeEventListener('abort', abort);
				xhr.onload = () => {
					cleanup();
					let result: { message?: string; error?: string };
					try {
						result = JSON.parse(xhr.responseText);
					} catch {
						setPhase('Falha na resposta do servidor.');
						reject(new Error('Resposta inválida. Tente novamente.'));
						return;
					}
					if (xhr.status < 200 || xhr.status >= 300) {
						setPhase('Upload não concluído.');
						reject(new Error(result.error || 'Falha no upload.'));
						return;
					}
					setReceipt({ name: file.name, size: file.size });
					setPhase('Arquivo recebido e confirmado pelo servidor.');
					onProgress(100);
					resolve();
				};
				xhr.onerror = () => {
					cleanup();
					setPhase('Falha de conexão. Use tentar novamente.');
					reject(new Error('Conexão interrompida. Tente novamente.'));
				};
				xhr.ontimeout = () => {
					cleanup();
					setPhase('Tempo de upload excedido.');
					reject(new Error('O upload excedeu 2 minutos. Tente novamente.'));
				};
				xhr.onabort = () => {
					cleanup();
					setReceipt(null);
					setPhase('Upload cancelado.');
					reject(new DOMException('Upload cancelado', 'AbortError'));
				};
				const body = new FormData();
				body.append('file', file);
				if (signal.aborted) {
					cleanup();
					reject(new DOMException('Cancelado', 'AbortError'));
					return;
				}
				xhr.send(body);
			}),
		[],
	);

	const valid =
		!!receipt &&
		selection.length === 1 &&
		!!name.trim() &&
		/^\d+\.\d+\.\d+([-.][\w.]+)?$/.test(version);

	async function publish() {
		if (!selection[0]) throw new Error('Aguarde a confirmação do upload.');
		await firmwareService.upload({
			file: selection[0],
			name: name.trim(),
			version: version.trim(),
			artifactType: type as never,
			...(description.trim() ? { description: description.trim() } : {}),
		});
		emitDataChanged();
	}

	return (
		<div className={s.formStack}>
			<Input
				label="Nome da release"
				value={name}
				onChange={(e) => setName(e.target.value)}
				placeholder="Ninbus 4.0.1"
			/>
			<Input
				label="Versão"
				value={version}
				onChange={(e) => setVersion(e.target.value)}
				placeholder="4.0.1"
				description="Use major.minor.patch, por exemplo 4.0.1."
			/>
			<Input
				label="Descrição (opcional)"
				value={description}
				onChange={(e) => setDescription(e.target.value)}
			/>
			<RadioGroup
				label="Tipo de arquivo"
				options={kindOptions}
				value={type}
				onValueChange={setType}
			/>
			<FileDropzone
				label="Arquivo da release"
				description="Arraste um arquivo ou escolha no dispositivo"
				accept=".fir,.frz,.nfx"
				multiple={false}
				maxFiles={1}
				maxSize={50 * 1024 * 1024}
				onUpload={upload}
				onFilesChange={(files) => {
					setSelection(files);
					if (!files.length) {
						setReceipt(null);
						setPhase('');
					}
				}}
				listPlacement="inside"
				note=".fir, .frz ou .nfx · até 50 MB · upload com confirmação do servidor"
				dropLabel="Solte para enviar"
			/>
			<p role="status" className={s.footnote}>
				{phase || 'O upload começa ao selecionar o arquivo. Remova a linha para cancelar.'}
			</p>
			<SafeAction
				label="publicar release"
				disabled={!valid}
				description="Publica no catálogo. A instalação é iniciada separadamente."
				onConfirm={publish}
			/>
			<Button variant="ghost" onClick={done}>
				Fechar
			</Button>
		</div>
	);
}

// ── atualização (real deploy) ──────────────────────────────────────────────

export function RolloutForm({
	companies,
	releases,
	devices,
	releaseId: initialRelease,
	companyId: initialCompany,
	done,
}: {
	companies: Company[];
	releases: FirmwareRelease[];
	devices: Device[];
	releaseId?: string;
	companyId?: string;
	done: () => void;
}) {
	const [company, setCompany] = useState(initialCompany ?? '');
	const [release, setRelease] = useState(initialRelease ?? '');
	const [selected, setSelected] = useState<string[]>([]);
	const r = releases.find((x) => x.id === release);

	const targets = devices
		.filter((d) => d.companyId === company && d.status === 'accepted')
		.map((d) => ({
			...d,
			group: '',
			companyName: companies.find((c) => c.id === d.companyId)?.name ?? '',
		}));

	async function deploy() {
		if (!r) throw new Error('Selecione uma release.');
		const result = await firmwareService.deploy(selected, r.artifactType, r.id);
		toast.success(result.message || 'Deploy iniciado.');
		emitDataChanged();
	}

	return (
		<div className={s.formStack}>
			<CompanyPicker
				companies={companies}
				value={company}
				onChange={(v) => {
					setCompany(v);
					setSelected([]);
				}}
			/>
			<MorphSelect
				label="Release"
				value={release || null}
				onValueChange={setRelease}
				searchable
				items={releases
					.filter((x) => x.status === 'published')
					.map((x) => ({
						value: x.id,
						label: `${x.name} · ${x.version}`,
						meta: kindOptions.find((k) => k.value === x.artifactType)?.label,
					}))}
			/>
			<Collection
				label="Dispositivos alvo"
				rows={targets}
				columns={[
					{ key: 'name', label: 'Dispositivo' },
					{ key: 'serialNumber', label: 'Serial' },
					{ key: 'connectionStatus', label: 'Conexão' },
				]}
				fields={[
					{
						id: 'connectionStatus',
						label: 'Conexão',
						options: ['connected', 'disconnected', 'unknown'],
					},
				]}
				selectable
				selected={selected}
				onSelectionChange={setSelected}
			/>
			<SafeAction
				label="criar deploy"
				disabled={!r || !company || !selected.length}
				description={`${selected.length} dispositivo(s) receberão ${r?.name ?? 'a release selecionada'}. ${r?.artifactType === 'firmware-ninbus' ? 'Firmware Ninbus reinicia o equipamento. ' : ''}A atualização é criada no serviço de distribuição e entregue no próximo contato do dispositivo.`}
				onConfirm={deploy}
			/>
			<Button variant="ghost" onClick={done}>
				Fechar
			</Button>
		</div>
	);
}
