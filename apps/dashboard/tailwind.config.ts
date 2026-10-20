import type { Config } from 'tailwindcss';

/**
 * Tailwind theme — FRT "field tool" system.
 *
 * Tokens vêm das CSS variables (globals.css). Escala de raios FRT:
 * r-sm 12 (inputs/chips) · r-md 16 (cards/KPIs) · r-lg 20 (hero/painéis) ·
 * r-xl 24 (painel principal). Sombras SEMPRE em 3 camadas (hairline + micro +
 * ambient) — nunca uma sombra só. Cores FRT são cirúrgicas: 90% da tela é
 * areia + ink.
 */
const config: Config = {
	darkMode: ['class'],
	content: ['./src/app/**/*.{js,ts,jsx,tsx,mdx}', './src/components/**/*.{js,ts,jsx,tsx,mdx}'],
	theme: {
		container: {
			center: true,
			padding: '1.5rem',
			screens: { '2xl': '1400px' },
		},
		extend: {
			fontFamily: {
				sans: ['var(--font-sans)', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
				mono: ['ui-monospace', "'SF Mono'", 'Menlo', 'monospace'],
			},
			colors: {
				border: 'hsl(var(--border))',
				'border-strong': 'hsl(var(--border-strong))',
				input: 'hsl(var(--input))',
				ring: 'hsl(var(--ring))',
				background: 'hsl(var(--background))',
				foreground: 'hsl(var(--foreground))',
				primary: {
					DEFAULT: 'hsl(var(--primary))',
					hover: 'hsl(var(--primary-hover))',
					foreground: 'hsl(var(--primary-foreground))',
				},
				secondary: {
					DEFAULT: 'hsl(var(--secondary))',
					foreground: 'hsl(var(--secondary-foreground))',
				},
				destructive: {
					DEFAULT: 'hsl(var(--destructive))',
					foreground: 'hsl(var(--destructive-foreground))',
				},
				muted: {
					DEFAULT: 'hsl(var(--muted))',
					foreground: 'hsl(var(--muted-foreground))',
				},
				accent: {
					DEFAULT: 'hsl(var(--accent))',
					foreground: 'hsl(var(--accent-foreground))',
				},
				popover: {
					DEFAULT: 'hsl(var(--popover))',
					foreground: 'hsl(var(--popover-foreground))',
				},
				card: {
					DEFAULT: 'hsl(var(--card))',
					foreground: 'hsl(var(--card-foreground))',
				},
				// ── Base neutra quente + ink ──────────────────────────────
				bg2: 'hsl(var(--bg-2))',
				sunk: 'hsl(var(--surface-sunk))',
				'surface-soft': 'hsl(var(--surface-soft))',
				ink: {
					DEFAULT: 'hsl(var(--ink))',
					2: 'hsl(var(--ink-2))',
					3: 'hsl(var(--ink-3))',
					4: 'hsl(var(--ink-4))',
				},
				// ── Tríade semântica FRT (+ soft pastéis de estado) ────────
				frt: {
					blue: 'hsl(var(--frt-blue))',
					'blue-dark': 'hsl(var(--frt-blue-dark))',
					'blue-soft': 'hsl(var(--frt-blue-soft))',
					green: 'hsl(var(--frt-green))',
					'green-soft': 'hsl(var(--frt-green-soft))',
					red: 'hsl(var(--frt-red))',
					'red-soft': 'hsl(var(--frt-red-soft))',
					info: 'hsl(var(--frt-info))',
					'info-soft': 'hsl(var(--frt-info-soft))',
					accent: 'hsl(var(--accent))',
				},
				// ── SIGNAL tones (estado apenas — via <Signal>) ────────────
				signal: {
					ok: 'hsl(var(--signal-ok))',
					busy: 'hsl(var(--signal-busy))',
					fault: 'hsl(var(--signal-fault))',
					idle: 'hsl(var(--signal-idle))',
					info: 'hsl(var(--signal-info))',
				},
				// ── Gráficos (FRT, sem neon) ──────────────────────────────
				brand: {
					blue: 'hsl(var(--chart-1))',
					green: 'hsl(var(--chart-2))',
					accent: 'hsl(var(--chart-3))',
					info: 'hsl(var(--chart-4))',
					neutral: 'hsl(var(--chart-5))',
				},
			},
			borderRadius: {
				sm: '12px',
				DEFAULT: '16px',
				md: '16px',
				lg: '20px',
				xl: '24px',
				'2xl': '24px',
			},
			boxShadow: {
				e1: 'var(--shadow-e1)',
				e2: 'var(--shadow-e2)',
			},
			keyframes: {
				'pulse-signal': {
					'0%, 100%': { opacity: '1' },
					'50%': { opacity: '0.35' },
				},
				'fade-in': {
					from: { opacity: '0', transform: 'translateY(2px)' },
					to: { opacity: '1', transform: 'translateY(0)' },
				},
				'accordion-down': {
					from: { height: '0' },
					to: { height: 'var(--radix-accordion-content-height)' },
				},
				'accordion-up': {
					from: { height: 'var(--radix-accordion-content-height)' },
					to: { height: '0' },
				},
			},
			animation: {
				'pulse-signal': 'pulse-signal 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
				'fade-in': 'fade-in 0.2s ease-out',
				'accordion-down': 'accordion-down 0.2s ease-out',
				'accordion-up': 'accordion-up 0.2s ease-out',
			},
		},
	},
	plugins: [require('tailwindcss-animate')],
};

export default config;
