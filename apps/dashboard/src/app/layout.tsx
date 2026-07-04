import { ThemeProvider } from '@/components/theme-provider';
import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Poppins } from 'next/font/google';
import { Toaster } from 'sonner';
import './globals.css';

/**
 * Root layout — fonts + theme.
 *
 * Poppins (sans) for all prose/UI — a clean geometric sans that reads well at
 * the dashboard's density. The CSS variable name is set EXPLICITLY to
 * '--font-sans' so it matches the Tailwind theme (`font-sans` utility). The
 * previous Geist setup set '--font-geist-sans' (mismatch) → fonts silently
 * fell back to the OS system font.
 *
 * JetBrains Mono for every MACHINE IDENTIFIER (serial, target ID, version,
 * UUID, key) — mono identifiers read as "infrastructure", not marketing copy.
 * Both fonts are self-hosted by next/font (no external requests, no FOUT).
 */
const sans = Poppins({
	subsets: ['latin'],
	weight: ['400', '500', '600', '700'],
	variable: '--font-sans',
	display: 'swap',
});

const mono = JetBrains_Mono({
	subsets: ['latin'],
	weight: ['400', '500', '600'],
	variable: '--font-mono',
	display: 'swap',
});

export const metadata: Metadata = {
	title: 'Ninbus',
	description: 'Console de operações OTA — provisioning, deployments e telemetria da frota.',
	manifest: '/console/manifest.webmanifest',
	applicationName: 'Ninbus',
	appleWebApp: {
		capable: true,
		title: 'Ninbus',
		statusBarStyle: 'black-translucent',
	},
	formatDetection: {
		telephone: false,
	},
	icons: {
		icon: [
			{ url: '/console/favicon-32.png', sizes: '32x32', type: 'image/png' },
			{ url: '/console/icon-192.png', sizes: '192x192', type: 'image/png' },
			{ url: '/console/icon-512.png', sizes: '512x512', type: 'image/png' },
		],
		apple: [{ url: '/console/apple-icon-180.png', sizes: '180x180' }],
	},
};

export const viewport: Viewport = {
	themeColor: '#0a0a0c',
	width: 'device-width',
	initialScale: 1,
	maximumScale: 5,
	viewportFit: 'cover',
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="pt-BR" suppressHydrationWarning>
			<body className={`${sans.variable} ${mono.variable} font-sans`}>
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
