import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
/**
 * Single source of truth for all environment configuration.
 *
 * Every config value used by the application MUST be declared here.
 * Validated at startup via TypeBox — fail-fast on misconfiguration.
 *
 * Rules:
 * - No `process.env[...]` outside this file
 * - No hardcoded URLs, ports, or secrets elsewhere
 * - Default values exist only for local development convenience
 */

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const EnvSchema = Type.Object({
	// ── Application ────────────────────────────────────────────
	NODE_ENV: Type.Union(
		[Type.Literal('development'), Type.Literal('production'), Type.Literal('test')],
		{ default: 'development' },
	),
	PORT: Type.Number({ default: 3000 }),
	HOST: Type.String({ default: '0.0.0.0' }),

	// ── Database ───────────────────────────────────────────────
	DATABASE_URL: Type.String({
		description: 'PostgreSQL connection string',
		pattern: '^(postgres|postgresql)://.+',
	}),

	// ── Authentication (Better Auth) ───────────────────────────
	ENABLE_AUTH: Type.Boolean({ default: true }),
	REQUIRE_EMAIL_VERIFICATION: Type.Boolean({ default: false }),
	BETTER_AUTH_SECRET: Type.Optional(
		Type.String({ minLength: 32, description: 'Secret key (min 32 chars)' }),
	),
	BETTER_AUTH_URL: Type.Optional(
		Type.String({
			description: 'Base URL for auth callbacks',
			pattern: '^https?://.+',
		}),
	),

	// ── Logging ────────────────────────────────────────────────
	LOG_LEVEL: Type.Union(
		[
			Type.Literal('fatal'),
			Type.Literal('error'),
			Type.Literal('warn'),
			Type.Literal('info'),
			Type.Literal('debug'),
			Type.Literal('trace'),
		],
		{ default: 'info' },
	),

	// ── CORS ───────────────────────────────────────────────────
	CORS_ORIGIN: Type.Array(Type.String(), {
		description: 'Allowed CORS origins (comma-separated in env)',
	}),

	// ── Email (Resend) ─────────────────────────────────────────
	RESEND_API_KEY: Type.Optional(Type.String({ description: 'Resend API key' })),
	EMAIL_FROM: Type.String({ description: 'Email sender address' }),

	// ── Mender Gateway Integration ─────────────────────────────
	MENDER_ENABLED: Type.Boolean({ default: false, description: 'Enable Mender integration' }),
	MENDER_GATEWAY_URL: Type.Optional(
		Type.String({
			description: 'Mender Traefik gateway base URL',
			pattern: '^https?://.+',
		}),
	),
	MENDER_PAT: Type.Optional(Type.String({ description: 'Mender Personal Access Token' })),
	MENDER_TIMEOUT_MS: Type.Optional(
		Type.Number({ default: 30000, description: 'Request timeout in ms' }),
	),
	MENDER_HOST_OVERRIDE: Type.Optional(
		Type.String({
			description: 'Override HTTP Host header sent to Mender Traefik (for host.docker.internal)',
		}),
	),
	MENDER_SKIP_TLS: Type.Boolean({
		default: false,
		description: 'Skip TLS certificate verification for Mender gateway',
	}),
	MENDER_TENANT_TOKEN: Type.Optional(
		Type.String({ description: 'Mender tenant token (for multi-tenant setups)' }),
	),

	// ── Rate Limiting ──────────────────────────────────────────
	ENABLE_RATE_LIMITER: Type.Boolean({ default: true }),
	RATE_LIMIT_WINDOW_MS: Type.Optional(Type.Number({ default: 60000 })),
	RATE_LIMIT_MAX: Type.Optional(Type.Number({ default: 100 })),
	AUTH_RATE_LIMIT_WINDOW_MS: Type.Optional(Type.Number({ default: 60000 })),
	AUTH_RATE_LIMIT_MAX: Type.Optional(Type.Number({ default: 10 })),
});

export type Env = Static<typeof EnvSchema>;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function parseCors(raw: string | undefined): string[] {
	if (!raw) return [];
	return raw
		.split(',')
		.map((o) => o.trim())
		.filter(Boolean);
}

export function validateEnv(): Env {
	const rawEnv = {
		NODE_ENV: process.env['NODE_ENV'] || 'development',
		PORT: Number(process.env['PORT'] ?? 3000),
		HOST: process.env['HOST'] || '0.0.0.0',
		DATABASE_URL: process.env['DATABASE_URL'],
		ENABLE_AUTH: process.env['ENABLE_AUTH'] !== 'false',
		REQUIRE_EMAIL_VERIFICATION: process.env['REQUIRE_EMAIL_VERIFICATION'] === 'true',
		BETTER_AUTH_SECRET: process.env['BETTER_AUTH_SECRET'],
		BETTER_AUTH_URL: process.env['BETTER_AUTH_URL'],
		LOG_LEVEL: process.env['LOG_LEVEL'] || 'info',
		CORS_ORIGIN: parseCors(process.env['CORS_ORIGIN']),
		RESEND_API_KEY: process.env['RESEND_API_KEY'],
		EMAIL_FROM: process.env['EMAIL_FROM'] || 'noreply@example.com',
		MENDER_ENABLED: process.env['MENDER_ENABLED'] === 'true',
		MENDER_GATEWAY_URL: process.env['MENDER_GATEWAY_URL'],
		MENDER_PAT: process.env['MENDER_PAT'],
		MENDER_TIMEOUT_MS: process.env['MENDER_TIMEOUT_MS']
			? Number(process.env['MENDER_TIMEOUT_MS'])
			: undefined,
		MENDER_HOST_OVERRIDE: process.env['MENDER_HOST_OVERRIDE'],
		MENDER_SKIP_TLS: process.env['MENDER_SKIP_TLS'] === 'true',
		MENDER_TENANT_TOKEN: process.env['MENDER_TENANT_TOKEN'],
		ENABLE_RATE_LIMITER: process.env['ENABLE_RATE_LIMITER'] !== 'false',
		RATE_LIMIT_WINDOW_MS: process.env['RATE_LIMIT_WINDOW_MS']
			? Number(process.env['RATE_LIMIT_WINDOW_MS'])
			: undefined,
		RATE_LIMIT_MAX: process.env['RATE_LIMIT_MAX']
			? Number(process.env['RATE_LIMIT_MAX'])
			: undefined,
		AUTH_RATE_LIMIT_WINDOW_MS: process.env['AUTH_RATE_LIMIT_WINDOW_MS']
			? Number(process.env['AUTH_RATE_LIMIT_WINDOW_MS'])
			: undefined,
		AUTH_RATE_LIMIT_MAX: process.env['AUTH_RATE_LIMIT_MAX']
			? Number(process.env['AUTH_RATE_LIMIT_MAX'])
			: undefined,
	};

	if (!Value.Check(EnvSchema, rawEnv)) {
		const errors = [...Value.Errors(EnvSchema, rawEnv)];
		const msg = errors.map((e) => `  - ${e.path}: ${e.message}`).join('\n');
		throw new Error(`[CONFIG] Environment validation failed:\n${msg}`);
	}

	return Value.Decode(EnvSchema, rawEnv);
}

export const env = validateEnv();
