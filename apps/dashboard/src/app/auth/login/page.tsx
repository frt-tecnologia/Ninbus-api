'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from '@/lib/auth/client';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';

// Login is fully client-side. Wrap the part that uses useSearchParams in a
// Suspense boundary (required by Next.js for static prerendering safety).
export const dynamic = 'force-dynamic';

export default function LoginPage() {
	return (
		<Suspense fallback={<LoginShell />}>
			<LoginForm />
		</Suspense>
	);
}

function LoginShell({ children }: { children?: React.ReactNode } = {}) {
	return (
		<div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
			<div className="w-full max-w-sm">
				<div className="mb-6 flex flex-col items-center">
					<div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-xl font-bold text-white">
						N
					</div>
					<h1 className="text-xl font-bold text-gray-900">Ninbus Admin</h1>
					<p className="mt-1 text-sm text-gray-500">
						Acesso restrito a administradores
					</p>
				</div>
				{children}
			</div>
		</div>
	);
}

function LoginForm() {
	const router = useRouter();
	const params = useSearchParams();
	const forbidden = params.get('error') === 'forbidden';

	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(
		forbidden
			? 'Esta conta não tem permissão de administrador da plataforma.'
			: null,
	);

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setLoading(true);
		setError(null);

		const result = await signIn.email({ email, password });

		if (result.error) {
			setLoading(false);
			setError('Credenciais inválidas. Verifique email e senha.');
			return;
		}

		// After successful sign-in, the layout guard re-checks super admin; if
		// not admin it redirects back here with ?error=forbidden.
		router.refresh();
		router.push('/admin/overview');
	}

	return (
		<LoginShell>
			<form
				onSubmit={handleSubmit}
				className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
			>
				<Field label="Email" htmlFor="email">
					<Input
						id="email"
						type="email"
						autoComplete="email"
						required
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						placeholder="admin@ninbus.com.br"
					/>
				</Field>

				<Field label="Senha" htmlFor="password">
					<Input
						id="password"
						type="password"
						autoComplete="current-password"
						required
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						placeholder="••••••••"
					/>
				</Field>

				{error && (
					<div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
						{error}
					</div>
				)}

				<Button type="submit" loading={loading} className="w-full">
					Entrar
				</Button>
			</form>

			<p className="mt-4 text-center text-xs text-gray-400">
				Somente contas autorizadas em SUPER_ADMIN_EMAILS podem acessar.
			</p>
		</LoginShell>
	);
}
