import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
	title: 'Ninbus Admin',
	description: 'Painel administrativo da plataforma Ninbus OTA',
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="pt-BR">
			<body className="antialiased">{children}</body>
		</html>
	);
}
