'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { signIn } from '@/lib/auth/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Brand } from '@/components/layout/brand';
import { BRAND_LOGOS } from '@/lib/brand-logos';

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
		<div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
			<div className="w-full max-w-sm">
				<div className="mb-8 flex flex-col items-center gap-5">
					<div className="h-20 w-20 animate-pulse rounded-2xl bg-muted" />
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
	const [showPassword, setShowPassword] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(
		forbidden ? 'Sua conta não tem permissão de acesso.' : null,
	);

	async function submit(e: FormEvent) {
		e.preventDefault();
		setLoading(true);
		setError(null);
		const result = await signIn.email({ email, password });
		if (result.error) {
			setLoading(false);
			setError('E-mail ou senha incorretos.');
			return;
		}
		router.refresh();
		router.push('/overview');
	}

	return (
		<div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
			{/* Soft radial gradient — primary glow top-right (mirrors the mobile app). */}
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 z-0"
				style={{
					background: `radial-gradient(60% 50% at 80% 20%, hsl(var(--primary) / 0.10), transparent 70%)`,
				}}
			/>

			<div className="relative z-10 w-full max-w-sm">
				{/* Centered logo + headline (matches the mobile auth header) */}
				<div className="mb-8 flex flex-col items-center gap-4">
					{/* eslint-disable-next-line @next/next/no-img-element */}
					<img
						src={BRAND_LOGOS.ninbus}
						alt="Ninbus"
						width={80}
						height={80}
						className="h-20 w-20 object-contain"
					/>
					<div className="text-center">
						<h1 className="text-2xl font-bold leading-tight tracking-tight">
							Bem-vindo de volta
						</h1>
						<p className="mt-1 text-sm text-muted-foreground">
							Entre para continuar no Ninbus
						</p>
					</div>
				</div>

				<form onSubmit={submit} className="flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						<label
							htmlFor="email"
							className="text-sm font-semibold text-foreground"
						>
							E-mail
						</label>
						<Input
							id="email"
							type="email"
							autoComplete="email"
							required
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							placeholder="Digite seu e-mail"
							className="h-12 rounded-[14px] border-transparent bg-muted/60"
						/>
					</div>

					<div className="flex flex-col gap-2">
						<label
							htmlFor="password"
							className="text-sm font-semibold text-foreground"
						>
							Senha
						</label>
						<div className="relative">
							<Input
								id="password"
								type={showPassword ? 'text' : 'password'}
								autoComplete="current-password"
								required
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								placeholder="Digite sua senha"
								className="h-12 rounded-[14px] border-transparent bg-muted/60 pr-11"
							/>
							<button
								type="button"
								onClick={() => setShowPassword((v) => !v)}
								className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
								aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
							>
								{showPassword ? (
									<EyeOff className="h-5 w-5" />
								) : (
									<Eye className="h-5 w-5" />
								)}
							</button>
						</div>
					</div>

					{error && (
						<div className="rounded-[14px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
							{error}
						</div>
					)}

					<Button
						type="submit"
						disabled={loading}
						className="mt-2 h-[52px] rounded-[14px] text-base font-bold"
					>
						{loading ? 'Entrando…' : 'Entrar'}
					</Button>
				</form>

				{/* Brand lockup — "Logo Ninbus | FRT logo" always visible. */}
				<div className="mt-10 flex justify-center">
					<Brand />
				</div>
			</div>
		</div>
	);
}
