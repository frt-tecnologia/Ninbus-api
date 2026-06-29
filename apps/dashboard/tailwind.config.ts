import type { Config } from 'tailwindcss';

/**
 * Tailwind theme — "Fleet Control Surface".
 *
 * Dark-first operational UI. Tokens come from CSS variables (globals.css) so a
 * single theme swap (next-themes `.dark`/`.light`) restyles everything. Color is
 * SEMANTIC: one action accent (`primary`, indigo) + five SIGNAL tones used only
 * for state. There is deliberately NO `brand-*` scale — the identity is the
 * typography (identifiers in mono), the signal geometry and the density, not a
 * decorative brand color everywhere.
 */
const config: Config = {
	darkMode: ['class'],
	content: [
		'./src/app/**/*.{js,ts,jsx,tsx,mdx}',
		'./src/components/**/*.{js,ts,jsx,tsx,mdx}',
	],
	theme: {
		container: {
			center: true,
			padding: '1.5rem',
			screens: { '2xl': '1400px' },
		},
		extend: {
			fontFamily: {
				sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui'],
				mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
			},
			colors: {
				border: 'hsl(var(--border))',
				input: 'hsl(var(--input))',
				ring: 'hsl(var(--ring))',
				background: 'hsl(var(--background))',
				foreground: 'hsl(var(--foreground))',
				primary: {
					DEFAULT: 'hsl(var(--primary))',
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
				// ── SIGNAL tones (state only) ──────────────────────────────
				// Backed by --signal-* channels. Used exclusively to convey
				// device/connection/deployment/phase state via <Signal>.
				signal: {
					ok: 'hsl(var(--signal-ok))',
					busy: 'hsl(var(--signal-busy))',
					fault: 'hsl(var(--signal-fault))',
					idle: 'hsl(var(--signal-idle))',
					info: 'hsl(var(--signal-info))',
				},
			},
			borderRadius: {
				lg: 'var(--radius)',
				md: 'calc(var(--radius) - 2px)',
				sm: 'calc(var(--radius) - 4px)',
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
