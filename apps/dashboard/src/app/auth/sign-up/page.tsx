'use client';
/**
 * Sign-up — Arc auth surface on the REAL Better Auth sign-up + immediate
 * sign-in. Accounts only reach the console with a pending designation or
 * super-admin e-mail (server-enforced).
 */
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Alert } from '@/components/arc/alert/alert';
import { Button } from '@/components/arc/button/button';
import { Input } from '@/components/arc/input/input';
import { PasswordField } from '@/components/arc/password-field/password-field';
import s from '@/components/arc-app/app.module.css';
import { signIn, signUp } from '@/lib/auth/client';
import { ROUTES } from '@/lib/routes';

export const dynamic = 'force-dynamic';

export default function SignUpPage() {
	const router = useRouter();
	const [name, setName] = useState('');
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function submit(e: FormEvent) {
		e.preventDefault();
		if (loading) return;
		setLoading(true);
		setError(null);

		const result = await signUp.email({ name, email, password });
		if (result.error) {
			setLoading(false);
			setError('Não foi possível criar a conta. Verifique os dados ou tente outro e-mail.');
			return;
		}

		const signed = await signIn.email({ email, password });
		setLoading(false);
		if (signed.error) {
			router.replace(`${ROUTES.login}?t=${Date.now()}`);
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

				<h1 className="mt-6">Criar conta</h1>
				<p className={s.muted}>O acesso ao console exige convite ou aprovação prévia.</p>

				<form className={s.formStack} onSubmit={submit} autoComplete="on" aria-busy={loading}>
					<Input
						label="Nome"
						required
						value={name}
						onChange={(e) => setName(e.target.value)}
						autoComplete="name"
						autoFocus
					/>
					<Input
						label="E-mail"
						type="email"
						required
						inputMode="email"
						autoCapitalize="none"
						spellCheck={false}
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						autoComplete="email"
					/>
					<PasswordField
						label="Senha"
						required
						minLength={8}
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						autoComplete="new-password"
						description="Mínimo de 8 caracteres."
						messages={{ showPassword: 'Mostrar senha', hidePassword: 'Ocultar senha' }}
					/>

					{/* Região viva: o leitor de tela anuncia o erro assim que ele
					    aparece, sem precisar mover o foco. */}
					<div role="alert" aria-live="polite" aria-atomic="true">
						{error && <Alert tone="danger" title={error} />}
					</div>

					<Button type="submit" loading={loading} disabled={loading}>
						Criar conta
					</Button>
				</form>

				<p className={s.muted}>
					Já tem conta?{' '}
					<Link href={ROUTES.login} className={s.link}>
						Entrar
					</Link>
				</p>
			</div>
		</div>
	);
}