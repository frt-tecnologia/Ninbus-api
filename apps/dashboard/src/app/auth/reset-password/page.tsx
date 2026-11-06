'use client';
/**
 * Reset password — Arc auth surface on the REAL token reset endpoint
 * (POST /api/auth/reset-password via the same-origin proxy).
 */
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, type ReactNode, Suspense, useState } from 'react';
import { Alert } from '@/components/arc/alert/alert';
import { Button } from '@/components/arc/button/button';
import { PasswordField } from '@/components/arc/password-field/password-field';
import s from '@/components/arc-app/app.module.css';
import { http } from '@/lib/api';
import { ROUTES } from '@/lib/routes';

export const dynamic = 'force-dynamic';

export default function ResetPasswordPage() {
	return (
		<Suspense fallback={<div className="min-h-dvh" aria-busy="true" />}>
			<ResetForm />
		</Suspense>
	);
}

function ResetShell({ children }: { children: ReactNode }) {
	// Shell de viewport: centraliza a coluna e só permite rolagem se o
	// conteúdo realmente não couber (ex.: teclado aberto no mobile).
	// min-h-dvh evita o "salto" da 100vh no Safari/Chrome mobile.
	return (
		<div className="min-h-dvh w-full flex items-center justify-center px-4 py-8 sm:py-12">
			<div className={s.auth}>
				{/* Logo preta → precisa de um "chip" claro para aparecer em
				    qualquer tema, no estilo de ícone de app. */}
				<div className="flex justify-center">
					<div className="inline-flex items-center justify-center rounded-2xl bg-white px-4 py-2.5 shadow-sm ring-1 ring-black/5">
						<Image
							src="/console/brand/ninbus-logo.png"
							alt="Ninbus"
							width={92}
							height={42}
							priority
							unoptimized
							className="h-auto w-[92px]"
						/>
					</div>
				</div>

				<h1 className="mt-6">Redefinir senha</h1>
				<p className={s.muted}>Use o link recebido por e-mail.</p>
				{children}
			</div>
		</div>
	);
}

function ResetForm() {
	const router = useRouter();
	const params = useSearchParams();
	const token = params.get('token') ?? '';

	const [password, setPassword] = useState('');
	const [confirm, setConfirm] = useState('');
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [done, setDone] = useState(false);

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		if (loading) return;
		setError(null);

		if (!token) {
			setError('Token inválido ou ausente. Solicite um novo link.');
			return;
		}
		if (password.length < 8) {
			setError('A senha deve ter no mínimo 8 caracteres.');
			return;
		}
		if (password !== confirm) {
			setError('As senhas não coincidem.');
			return;
		}

		setLoading(true);
		try {
			await http.post('/auth/reset-password', { token, newPassword: password });
			setDone(true);
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: 'Não foi possível redefinir. O link pode ter expirado.',
			);
		} finally {
			setLoading(false);
		}
	}

	if (done) {
		return (
			<ResetShell>
				{/* role=status anuncia a confirmação para o leitor de tela. */}
				<div role="status" aria-live="polite" aria-atomic="true">
					<Alert tone="success" title="Senha alterada. Você já pode entrar." />
				</div>
				<Button onClick={() => router.push(`${ROUTES.login}?t=${Date.now()}`)}>
					Ir para o login
				</Button>
			</ResetShell>
		);
	}

	return (
		<ResetShell>
			<form
				onSubmit={handleSubmit}
				className={s.formStack}
				autoComplete="on"
				aria-busy={loading}
			>
				<PasswordField
					label="Nova senha"
					required
					minLength={8}
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					autoComplete="new-password"
					autoFocus
					messages={{ showPassword: 'Mostrar senha', hidePassword: 'Ocultar senha' }}
				/>
				<PasswordField
					label="Confirmar senha"
					required
					minLength={8}
					value={confirm}
					onChange={(e) => setConfirm(e.target.value)}
					autoComplete="new-password"
					messages={{ showPassword: 'Mostrar senha', hidePassword: 'Ocultar senha' }}
				/>

				{/* Região viva: o leitor de tela anuncia o erro assim que ele
				    aparece, sem precisar mover o foco. */}
				<div role="alert" aria-live="polite" aria-atomic="true">
					{error && <Alert tone="danger" title={error} />}
				</div>

				<Button type="submit" loading={loading} disabled={loading}>
					Alterar senha
				</Button>

				<Link href={ROUTES.login} className={s.link}>
					Voltar ao login
				</Link>
			</form>
		</ResetShell>
	);
}