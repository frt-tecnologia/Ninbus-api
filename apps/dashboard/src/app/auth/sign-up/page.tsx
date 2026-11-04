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
			<h1>Criar conta</h1>
			<p className={s.muted}>O acesso ao console exige convite ou aprovação prévia.</p>
			<form className={s.formStack} onSubmit={submit}>
				<Input
					label="Nome"
					required
					value={name}
					onChange={(e) => setName(e.target.value)}
					autoComplete="name"
				/>
				<Input
					label="E-mail"
					type="email"
					required
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
				<Button type="submit" loading={loading}>
					Criar conta
				</Button>
				{error && <Alert tone="danger" title={error} />}
			</form>
			<p className={s.muted}>
				Já tem conta?{' '}
				<Link href={ROUTES.login} className={s.link}>
					Entrar
				</Link>
			</p>
		</div>
	);
}
