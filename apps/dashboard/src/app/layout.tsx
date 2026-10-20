import type { Metadata } from 'next';
import { Nunito_Sans } from 'next/font/google';
import { Toaster } from 'sonner';
import { KillSwitchSW } from '@/components/kill-switch-sw';
import { ThemeProvider } from '@/components/theme-provider';
import { BRAND_LOGOS } from '@/lib/brand-logos';
import './globals.css';

/**
 * Root layout — fonts + theme.
 *
 * FRT design system: Nunito Sans (400–900) é a voz primária — humanista,
 * calma, legível em campo. Mono é a pilha do sistema (SF Mono/Menlo), usada
 * APENAS em identificadores de máquina (serial, ID, hash, versão de firmware).
 * Ambos auto-hospedados/locais — sem requests externos, sem FOUT.
 *
 * Tema: claro areia (single theme). O sistema FRT não define paleta escura —
 * inventar uma violaria "não invente novos valores".
 */
const sans = Nunito_Sans({
	subsets: ['latin'],
	weight: ['400', '600', '700', '800', '900'],
	variable: '--font-sans',
	display: 'swap',
});

export const metadata: Metadata = {
	title: 'Ninbus',
	description: 'Console de operações OTA — provisioning, deployments e telemetria da frota.',
	icons: {
		icon: BRAND_LOGOS.ninbus,
		apple: BRAND_LOGOS.ninbus,
	},
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="pt-BR" suppressHydrationWarning>
			<body className={`${sans.variable} font-sans`}>
				<ThemeProvider
					attribute="class"
					defaultTheme="light"
					forcedTheme="light"
					disableTransitionOnChange
				>
					{children}
					<Toaster position="bottom-right" theme="light" />
					<KillSwitchSW />
				</ThemeProvider>
			</body>
		</html>
	);
}
