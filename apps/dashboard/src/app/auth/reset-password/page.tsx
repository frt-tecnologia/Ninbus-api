'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { http } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/system';

/**
 * Web password-reset fallback. Email links point to /reset-password?token=...
 * (nginx redirects root → /admin/auth/reset-password). When the mobile app is
 * installed the App Link intercepts; otherwise the browser lands here and the
 * new password is POSTed to the API /api/auth/reset-password via the proxy.
 */
export const dynamic = 'force-dynamic';

export default function ResetPasswordPage() {
	return (
		<Suspense fallback={<ResetShell />}>
			<ResetForm />
		</Suspense>
	);
}

function ResetShell({ children, done }: { children?: React.ReactNode; done?: boolean }) {
	return (
		<div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-12">
			<div className="w-full max-w-sm">
				<div className="mb-8 flex items-center gap-2.5">
					<div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary font-mono text-base font-bold text-primary-foreground">
						N
					</div>
					<div className="leading-tight">
						<div className="text-sm font-semibold tracking-tight">Ninbus</div>
						<div className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">
							Fleet Control
						</div>
					</div>
				</div>
				<h1 className="text-lg font-semibold tracking-tight">
					{done ? 'Senha alterada' : 'Redefinir senha'}
				</h1>
				<div className="mt-6">{children}</div>
			</div>
		</div>
	);
}

function ResetForm() {
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
			<ResetShell done>
				<div className="rounded-md border border-signal-ok/30 bg-signal-ok/10 px-4 py-3 text-sm text-signal-ok">
					Senha alterada. Você já pode entrar no aplicativo.
				</div>
			</ResetShell>
		);
	}

	return (
		<ResetShell>
			<form onSubmit={handleSubmit} className="flex flex-col gap-4">
				<Field label="Nova senha" htmlFor="password" required>
					<Input
						id="password"
						type="password"
						required
						minLength={8}
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						placeholder="Mínimo 8 caracteres"
					/>
				</Field>
				<Field label="Confirmar senha" htmlFor="confirm" required>
					<Input
						id="confirm"
						type="password"
						required
						minLength={8}
						value={confirm}
						onChange={(e) => setConfirm(e.target.value)}
						placeholder="Repita a senha"
					/>
				</Field>
				{error && (
					<div className="rounded-md border border-signal-fault/30 bg-signal-fault/10 px-3 py-2 text-sm text-signal-fault">
						{error}
					</div>
				)}
				<Button type="submit" disabled={loading} className="mt-1 w-full">
					{loading ? 'Alterando…' : 'Alterar senha'}
				</Button>
			</form>
		</ResetShell>
	);
}
