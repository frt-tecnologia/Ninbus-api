'use client';
import Image from 'next/image';
/**
 * Login — Arc auth surface (the reference's auth view) on the REAL Better
 * Auth sign-in. Error shows only what the server decided; success navigates.
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useState } from 'react';
import { Alert } from '@/components/arc/alert/alert';
import { Button } from '@/components/arc/button/button';
import { Input } from '@/components/arc/input/input';
import { PasswordField } from '@/components/arc/password-field/password-field';
import s from '@/components/arc-app/app.module.css';
import { signIn } from '@/lib/auth/client';
import { ROUTES } from '@/lib/routes';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
	return (
		<Suspense fallback={<div className="min-h-dvh" aria-busy="true" />}>
			<LoginForm />
		</Suspense>
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
		forbidden ? 'Sua conta não tem permissão de acesso.' : null,
	);

	async function submit(e: FormEvent) {
		e.preventDefault();
		if (loading) return;
		setLoading(true);
		setError(null);
		const result = await signIn.email({ email, password });
		if (result.error) {
			setLoading(false);
			setError('E-mail ou senha incorretos.');
			return;
		}
		router.refresh();
		router.replace(ROUTES.overview);
	}

	return (
		// Shell de viewport: centraliza a coluna e só permite rolagem se o
		// conteúdo realmente não couber (ex.: teclado aberto no mobile).
		// min-h-dvh evita o "salto" da 100vh no Safari/Chrome mobile.
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

				<h1 className="mt-6">Acesse sua frota</h1>
				<p className={s.muted}>Console de administração OTA</p>

				<form
					className={s.formStack}
					onSubmit={submit}
					autoComplete="on"
					aria-busy={loading}
				>
					<Input
						label="E-mail"
						type="email"
						autoComplete="email"
						inputMode="email"
						autoCapitalize="none"
						spellCheck={false}
						required
						autoFocus
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						placeholder="voce@empresa.com"
					/>
					<PasswordField
						label="Senha"
						required
						autoComplete="current-password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						messages={{ showPassword: 'Mostrar senha', hidePassword: 'Ocultar senha' }}
					/>
					<Button type="submit" loading={loading} disabled={loading}>
						Entrar
					</Button>

					{/* Região viva: o leitor de tela anuncia o erro assim que ele
					    aparece, sem precisar mover o foco. */}
					<div role="alert" aria-live="polite" aria-atomic="true">
						{error && <Alert tone="danger" title={error} />}
					</div>
				</form>

				<p className={s.authLinks}>
					<Link href={ROUTES.resetPassword} className={s.link}>
						Esqueci minha senha
					</Link>
				</p>
				<p className={s.muted}>
					Não tem conta?{' '}
					<Link href={ROUTES.signUp} className={s.link}>
						Criar conta
					</Link>
				</p>
			</div>
		</div>
	);
}