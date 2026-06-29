import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { Toaster } from 'sonner';
import { ThemeProvider } from '@/components/theme-provider';
import './globals.css';

/**
 * Root layout — fonts + theme.
 *
 * Geist (sans) for prose/UI, Geist Mono for every MACHINE IDENTIFIER (serial,
 * target ID, version, UUID, key). The mono identifiers are the single most
 * distinctive, domain-authentic typographic choice — they read as "this is
 * infrastructure", not "this is a marketing site".
 */
export const metadata: Metadata = {
	title: 'Ninbus · Fleet Control',
	description: 'Console de operações OTA — provisioning, deployments e telemetria da frota.',
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="pt-BR" suppressHydrationWarning>
			<body
				className={`${GeistSans.variable} ${GeistMono.variable} font-sans`}
			>
				<ThemeProvider
					attribute="class"
					defaultTheme="dark"
					enableSystem={false}
					disableTransitionOnChange
				>
					{children}
					<Toaster position="bottom-right" theme="dark" />
				</ThemeProvider>
			</body>
		</html>
	);
}
