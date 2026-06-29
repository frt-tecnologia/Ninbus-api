'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ThemeProviderProps } from 'next-themes';

/**
 * Theme provider — dark-first ("Fleet Control Surface" = NOC aesthetic).
 * next-themes toggles the `dark` class on <html>; globals.css defines dark
 * tokens on `:root,.dark` and light tokens on `.light`.
 */
export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
	return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
