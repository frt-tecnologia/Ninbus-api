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
		<Suspense fallback={<div className={s.auth} aria-busy="true" />}>
			<ResetForm />
		</Suspense>
	);
}

function ResetShell({ children }: { children: ReactNode }) {
	return (
		<div className={s.auth}>
			<div className={s.authBrand}>
				<Image
					src="/console/brand/ninbus-logo.png"
					alt="Ninbus"
					width={92}
					height={42}
					priority
					unoptimized
				/>
			</div>
			<h1>Redefinir senha</h1>
			<p className={s.muted}>Use o link recebido por e-mail.</p>
			{children}
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
				<Alert tone="success" title="Senha alterada. Você já pode entrar." />
				<Button onClick={() => router.push(`${ROUTES.login}?t=${Date.now()}`)}>
					Ir para o login
				</Button>
			</ResetShell>
		);
	}

	return (
		<ResetShell>
			<form onSubmit={handleSubmit} className={s.formStack}>
				<PasswordField
					label="Nova senha"
					required
					minLength={8}
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					autoComplete="new-password"
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
				{error && <Alert tone="danger" title={error} />}
				<Button type="submit" loading={loading}>
					Alterar senha
				</Button>
				<Link href={ROUTES.login} className={s.link}>
					Voltar ao login
				</Link>
			</form>
		</ResetShell>
	);
}
