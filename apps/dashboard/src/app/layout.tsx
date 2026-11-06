import type { Metadata } from 'next';
import { Geist, Inter } from 'next/font/google';
import { Toaster } from 'sonner';
import { KillSwitchSW } from '@/components/kill-switch-sw';
import { ThemeProvider } from '@/components/theme-provider';
import { BRAND_LOGOS } from '@/lib/brand-logos';
import '@/components/arc/foundation.css';
import '@/app/globals.css';

/**
 * Root layout — Arc UI foundation.
 *
 * Geist (display) + Inter (body), self-hosted via next/font — the two
 * variables foundation.css expects (--font-geist / --font-inter). Arc tokens
 * (semantic, light/dark) come from foundation.css; dark mode is data-theme
 * driven (see ThemeProvider attribute).
 */
const geist = Geist({
	subsets: ['latin'],
	variable: '--font-geist',
	display: 'swap',
});

const inter = Inter({
	subsets: ['latin'],
	variable: '--font-inter',
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
			<body className={`${geist.variable} ${inter.variable}`}>
				<ThemeProvider attribute="data-theme" defaultTheme="light" enableSystem={false}>
					{children}
					<Toaster position="bottom-right" theme="system" />
					<KillSwitchSW />
				</ThemeProvider>
			</body>
		</html>
	);
}
