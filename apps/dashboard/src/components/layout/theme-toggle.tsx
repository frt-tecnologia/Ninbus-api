'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Theme toggle — dark-first, but the light theme is one click away. Compact
 * icon button for the topbar.
 */
export function ThemeToggle() {
	const { theme, setTheme } = useTheme();
	const [mounted, setMounted] = React.useState(false);
	React.useEffect(() => setMounted(true), []);
	// Avoid hydration mismatch: render a stable placeholder until mounted.
	if (!mounted) return <div className="h-9 w-9" />;
	const isDark = theme !== 'light';
	return (
		<Button
			variant="ghost"
			size="icon"
			aria-label={isDark ? 'Ativar tema claro' : 'Ativar tema escuro'}
			onClick={() => setTheme(isDark ? 'light' : 'dark')}
		>
			{isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
		</Button>
	);
}
