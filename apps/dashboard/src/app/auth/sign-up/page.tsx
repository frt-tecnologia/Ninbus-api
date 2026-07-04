'use client';

import { Brand } from '@/components/layout/brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { signIn, signUp } from '@/lib/auth/client';
import { BRAND_LOGOS } from '@/lib/brand-logos';
import { ROUTES } from '@/lib/routes';
import { Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, Suspense, useState } from 'react';

export const dynamic = 'force-dynamic';

export default function SignUpPage() {
	return (
		<Suspense fallback={<LoginShell />}>
			<SignUpForm />
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

function SignUpForm() {
	const router = useRouter();

	const [name, setName] = useState('');
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [showPassword, setShowPassword] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function submit(e: FormEvent) {
		e.preventDefault();
		setLoading(true);
		setError(null);

		// 1) Register the account via the Better Auth sign-up endpoint.
		const result = await signUp.email({ name, email, password });
		if (result.error) {
			setLoading(false);
			setError('Não foi possível criar a conta. Verifique os dados ou tente outro e-mail.');
			return;
		}

		// 2) Immediately sign in (signUp may not establish a session in all configs).
		const session = await signIn.email({ email, password });
		if (session.error) {
			setLoading(false);
			// Account was created — route to login so they can authenticate.
			router.push(ROUTES.login);
			return;
		}

		router.refresh();
		router.replace(ROUTES.overview);
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
				{/* Centered logo + headline */}
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
						<h1 className="text-2xl font-bold leading-tight tracking-tight">Criar conta</h1>
						<p className="mt-1 text-sm text-muted-foreground">Cadastre-se para acessar o Ninbus</p>
					</div>
				</div>

				<form onSubmit={submit} className="flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						<label htmlFor="name" className="text-sm font-semibold text-foreground">
							Nome
						</label>
						<Input
							id="name"
							type="text"
							autoComplete="name"
							required
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Seu nome"
							className="h-12 rounded-[14px] border-transparent bg-muted/60"
						/>
					</div>

					<div className="flex flex-col gap-2">
						<label htmlFor="email" className="text-sm font-semibold text-foreground">
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
						<label htmlFor="password" className="text-sm font-semibold text-foreground">
							Senha
						</label>
						<div className="relative">
							<Input
								id="password"
								type={showPassword ? 'text' : 'password'}
								autoComplete="new-password"
								required
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								placeholder="Crie uma senha"
								className="h-12 rounded-[14px] border-transparent bg-muted/60 pr-11"
							/>
							<button
								type="button"
								onClick={() => setShowPassword((v) => !v)}
								className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
								aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
							>
								{showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
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
						{loading ? 'Criando conta…' : 'Cadastrar'}
					</Button>
				</form>

				<p className="mt-6 text-center text-sm text-muted-foreground">
					Já tem conta?{' '}
					<Link
						href={ROUTES.login}
						className="font-semibold text-foreground underline-offset-4 hover:underline"
					>
						Entrar
					</Link>
				</p>

				{/* Brand lockup — "Logo Ninbus | FRT logo" always visible. */}
				<div className="mt-10 flex justify-center">
					<Brand />
				</div>
			</div>
		</div>
	);
}
