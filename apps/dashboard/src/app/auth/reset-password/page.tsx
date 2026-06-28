'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { http } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';

/**
 * Web password-reset fallback.
 *
 * Email links point to ninbus.frt.com.br/reset-password?token=... (root). When
 * the app is installed, the App Link opens the mobile app instead. When the app
 * is NOT installed (or App Link not yet verified), the browser lands here and
 * the user can reset their password on the web.
 *
 * The token comes from the email; the new password is POSTed to the API
 * /api/auth/reset-password through the proxy.
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
		<div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
			<div className="w-full max-w-sm">
				<div className="mb-6 flex flex-col items-center">
					<div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-xl font-bold text-white">
						N
					</div>
					<h1 className="text-xl font-bold text-gray-900">
						{done ? 'Senha alterada' : 'Redefinir senha'}
					</h1>
				</div>
				{children}
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
			setError('Token inválido ou ausente. Solicite um novo link de redefinição.');
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
					: 'Não foi possível redefinir a senha. O link pode ter expirado.',
			);
		} finally {
			setLoading(false);
		}
	}

	if (done) {
		return (
			<ResetShell done>
				<div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
					<p className="text-sm text-green-800">
						Sua senha foi alterada com sucesso. Você já pode entrar no aplicativo.
					</p>
				</div>
			</ResetShell>
		);
	}

	return (
		<ResetShell>
			<form
				onSubmit={handleSubmit}
				className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
			>
				<Field label="Nova senha" htmlFor="password">
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
				<Field label="Confirmar senha" htmlFor="confirm">
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
					<div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
						{error}
					</div>
				)}
				<Button type="submit" loading={loading} className="w-full">
					Alterar senha
				</Button>
			</form>
		</ResetShell>
	);
}
