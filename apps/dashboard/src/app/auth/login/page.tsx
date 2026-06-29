'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from '@/lib/auth/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/system';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
	return (
		<Suspense fallback={<LoginShell />}>
			<LoginForm />
		</Suspense>
	);
}

/** Static shell (no hooks) — safe as a Suspense fallback. */
function LoginShell() {
	return (
		<div className="relative z-10 grid min-h-screen lg:grid-cols-2">
			<aside className="relative hidden flex-col justify-between overflow-hidden border-r border-border bg-card/40 p-10 lg:flex">
				<div className="flex items-center gap-2.5">
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
			</aside>
			<div className="flex items-center justify-center px-4 py-12">
				<div className="w-full max-w-sm">
					<div className="h-8 w-8 animate-pulse rounded-md bg-muted" />
				</div>
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
			? 'Esta conta não tem permissão de super administrador.'
			: null,
	);

	async function submit(e: FormEvent) {
		e.preventDefault();
		setLoading(true);
		setError(null);
		const result = await signIn.email({ email, password });
		if (result.error) {
			setLoading(false);
			setError('Credenciais inválidas. Verifique email e senha.');
			return;
		}
		router.refresh();
		router.push('/overview');
	}

	return (
		<div className="relative z-10 grid min-h-screen lg:grid-cols-2">
			{/* Brand / console panel (desktop) */}
			<aside className="relative hidden flex-col justify-between overflow-hidden border-r border-border bg-card/40 p-10 lg:flex">
				<div className="flex items-center gap-2.5">
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
				<div>
					<h1 className="max-w-sm text-2xl font-semibold leading-tight tracking-tight">
						Console de operações OTA para frotas IoT.
					</h1>
					<p className="mt-3 max-w-sm text-sm text-muted-foreground">
						Provisioning, deployments e telemetria de dispositivos em tempo real —
						uma única superfície de controle.
					</p>
				</div>
				<div className="font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground/60">
					Rev. {new Date().getFullYear()} · acesso restrito
				</div>
			</aside>

			{/* Form panel */}
			<div className="flex items-center justify-center px-4 py-12">
				<div className="w-full max-w-sm">
					<div className="mb-8 flex flex-col lg:hidden">
						<div className="flex items-center gap-2.5">
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
					</div>

					<h2 className="text-lg font-semibold tracking-tight">Acesso</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						Restrito a contas autorizadas em <span className="font-mono text-xs">SUPER_ADMIN_EMAILS</span>.
					</p>

					<form onSubmit={submit} className="mt-6 flex flex-col gap-4">
						<Field label="Email" htmlFor="email" required>
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
						<Field label="Senha" htmlFor="password" required>
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
							<div className="rounded-md border border-signal-fault/30 bg-signal-fault/10 px-3 py-2 text-sm text-signal-fault">
								{error}
							</div>
						)}

						<Button type="submit" disabled={loading} className="mt-2 w-full">
							{loading ? 'Entrando…' : 'Entrar'}
						</Button>
					</form>
				</div>
			</div>
		</div>
	);
}
