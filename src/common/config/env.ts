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
	AUTH_COOKIE_SECURE: Type.Boolean({
		default: false,
		description:
			'Set session cookies with the __Secure- prefix + Secure flag. ' +
			'ONLY enable when the public-facing connection is HTTPS end-to-end ' +
			'(dashboard behind TLS). Over plain HTTP the browser DROPS Secure cookies, ' +
			'which silently breaks login (POST returns 200 + set-cookie but the cookie ' +
			'is never stored → the app stays on the login screen). Default false so the ' +
			'dashboard works over HTTP during the HTTP-only phase; flip to true once ' +
			'TLS (HTTPS) is live. NOTE: not tied to NODE_ENV — containers run ' +
			'NODE_ENV=production even over HTTP.',
	}),

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
	FRONTEND_URL: Type.Optional(
		Type.String({
			description: 'Frontend app base URL (for email links: password reset, email verification)',
			pattern: '^https?://.+',
		}),
	),
	APP_DEEP_LINK_BASE: Type.Optional(
		Type.String({
			description:
				'Base for app deep links in emails (password reset, email verification). ' +
				'Accepts a custom scheme like "ninbus://" (fallback when no verified web domain yet) ' +
				'or an https App Link like "https://ninbus.frt.com.br". ' +
				'Takes precedence over FRONTEND_URL for email links.',
			pattern: '^[a-z][a-z0-9+.-]*://',
		}),
	),
	// Resend Dashboard template aliases (or tmpl_ IDs). Templates render subject +
	// body server-side at Resend; the API passes only the variables. Template
	// must be PUBLISHED in the Resend dashboard before it can be used for sending.
	RESEND_TEMPLATE_PASSWORD_RESET: Type.Optional(
		Type.String({
			description:
				'Resend template alias/ID for password reset emails. Template variables: first_name, reset_password_url',
		}),
	),
	RESEND_TEMPLATE_EMAIL_VERIFICATION: Type.Optional(
		Type.String({
			description:
				'Resend template alias/ID for email verification emails. Template variables: first_name, verify_email_url',
		}),
	),

	// ── hawkBit Update Server Integration ──────────────────────
	HAWKBIT_ENABLED: Type.Boolean({ default: false, description: 'Enable hawkBit integration' }),
	HAWKBIT_URL: Type.Optional(
		Type.String({
			description: 'hawkBit Management API base URL',
			pattern: '^https?://.+',
		}),
	),
	HAWKBIT_USERNAME: Type.Optional(
		Type.String({ description: 'hawkBit admin username (Basic Auth)' }),
	),
	HAWKBIT_PASSWORD: Type.Optional(
		Type.String({ description: 'hawkBit admin password (Basic Auth)' }),
	),
	HAWKBIT_TIMEOUT_MS: Type.Optional(
		Type.Number({ default: 30000, description: 'Request timeout in ms' }),
	),
	HAWKBIT_SKIP_TLS: Type.Boolean({
		default: false,
		description: 'Skip TLS certificate verification for hawkBit',
	}),

	// ── hawkBit DDI Auto-Provisioning ──────────────────────────
	HAWKBIT_AUTOPROVISIONING: Type.Boolean({
		default: false,
		description:
			'When true, unknown devices can auto-provision on first DDI poll. ' +
			'SET TO FALSE IN PRODUCTION — only pre-registered devices (via POST /api/devices/provision) should connect.',
	}),

	// ── hawkBit Background Sync ────────────────────────────────
	HAWKBIT_SYNC_MODE: Type.Union(
		[Type.Literal('periodic'), Type.Literal('on_demand'), Type.Literal('hybrid')],
		{
			default: 'hybrid',
			description:
				'Sync strategy for hawkBit → local DB. ' +
				'"periodic": background sync of ALL targets every N seconds (good for <1k devices). ' +
				'"on_demand": zero background sync — each API request fetches from hawkBit with stale-while-revalidate cache. ' +
				'"hybrid" (recommended): background sync ONLY for companies with active user sessions + on-demand for single device detail. Scales to 50k+ devices.',
		},
	),
	HAWKBIT_SYNC_INTERVAL_SEC: Type.Optional(
		Type.Number({
			default: 30,
			minimum: 5,
			description:
				'Background sync interval in seconds (used by periodic and hybrid modes). ' +
				'Set to 0 to disable background sync entirely (forces on_demand behavior).',
		}),
	),
	HAWKBIT_SYNC_STALE_SEC: Type.Optional(
		Type.Number({
			default: 60,
			minimum: 5,
			description:
				'Stale threshold in seconds for on-demand single-device sync. ' +
				'If local data is older than this, triggers a hawkBit API call to refresh.',
		}),
	),
	HAWKBIT_SYNC_ACTIVE_WINDOW_SEC: Type.Optional(
		Type.Number({
			default: 300,
			minimum: 30,
			description:
				'Window in seconds to consider a company "active" (has user sessions within this time). ' +
				'Only active companies are synced in hybrid mode. Default 300s (5 min).',
		}),
	),

	// ── Artifacts (upload limits) ─────────────────────────────
	ARTIFACT_MAX_SIZE_MB: Type.Integer({
		default: 50,
		minimum: 1,
		maximum: 1024,
		description:
			'Max firmware upload size in MB. Defends against memory DoS (the tar packager buffers the file in RAM).',
	}),

	// ── SSE (Server-Sent Events) ──────────────────────────────
	SSE_ENABLED: Type.Boolean({
		default: true,
		description: 'Enable SSE endpoint for real-time event push to Flutter clients.',
	}),
	SSE_HEARTBEAT_SEC: Type.Optional(
		Type.Number({
			default: 30,
			minimum: 10,
			description:
				'Heartbeat interval in seconds for SSE connections. Keeps connections alive through proxies.',
		}),
	),
	SSE_MAX_CONNECTIONS_PER_COMPANY: Type.Optional(
		Type.Number({
			default: 50,
			minimum: 1,
			description: 'Maximum concurrent SSE connections per company. Oldest evicted when exceeded.',
		}),
	),

	// ── Platform Super Admin ───────────────────────────────────
	SUPER_ADMIN_EMAILS: Type.Array(Type.String(), {
		default: [],
		description:
			'Comma-separated list of emails with platform-level super admin access. ' +
			'Super admins can manage ALL companies, devices, users, and provisioning. ' +
			'This is NOT a database role — controlled solely via environment variable to prevent privilege escalation.',
	}),

	// ── Rate Limiting ──────────────────────────────────────────
	ENABLE_RATE_LIMITER: Type.Boolean({ default: true }),
	RATE_LIMIT_WINDOW_MS: Type.Optional(Type.Number({ default: 60000 })),
	RATE_LIMIT_MAX: Type.Optional(Type.Number({ default: 150 })),
	AUTH_RATE_LIMIT_WINDOW_MS: Type.Optional(Type.Number({ default: 60000 })),
	AUTH_RATE_LIMIT_MAX: Type.Optional(Type.Number({ default: 20 })),

	// ── Observability (audit + telemetry retention) ────────────
	OBS_CONNECTIONS_RETENTION_DAYS: Type.Optional(
		Type.Number({
			minimum: 1,
			default: 90,
			description:
				'Device connection telemetry retention in days. Rows older than this are ' +
				'batch-deleted by the background retention job (runs hourly). ' +
				'Default 90 days. Set to 0 to disable retention (keep forever). ' +
				'activity_log is an audit log and is NEVER expired.',
		}),
	),
});

export type Env = Static<typeof EnvSchema>;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function parseStringArray(raw: string | undefined): string[] {
	if (!raw) return [];
	return raw
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

/** @deprecated Use parseStringArray instead */
const parseCors = parseStringArray;

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
		AUTH_COOKIE_SECURE: process.env['AUTH_COOKIE_SECURE'] === 'true',
		LOG_LEVEL: process.env['LOG_LEVEL'] || 'info',
		CORS_ORIGIN: parseCors(process.env['CORS_ORIGIN']),
		RESEND_API_KEY: process.env['RESEND_API_KEY'],
		EMAIL_FROM: process.env['EMAIL_FROM'] || 'noreply@example.com',
		FRONTEND_URL: process.env['FRONTEND_URL'],
		APP_DEEP_LINK_BASE: process.env['APP_DEEP_LINK_BASE'],
		RESEND_TEMPLATE_PASSWORD_RESET: process.env['RESEND_TEMPLATE_PASSWORD_RESET'],
		RESEND_TEMPLATE_EMAIL_VERIFICATION: process.env['RESEND_TEMPLATE_EMAIL_VERIFICATION'],
		HAWKBIT_ENABLED: process.env['HAWKBIT_ENABLED'] === 'true',
		HAWKBIT_URL: process.env['HAWKBIT_URL'],
		HAWKBIT_USERNAME: process.env['HAWKBIT_USERNAME'],
		HAWKBIT_PASSWORD: process.env['HAWKBIT_PASSWORD'],
		HAWKBIT_TIMEOUT_MS: process.env['HAWKBIT_TIMEOUT_MS']
			? Number(process.env['HAWKBIT_TIMEOUT_MS'])
			: undefined,
		HAWKBIT_SKIP_TLS: process.env['HAWKBIT_SKIP_TLS'] === 'true',
		HAWKBIT_AUTOPROVISIONING: process.env['HAWKBIT_AUTOPROVISIONING'] === 'true',
		HAWKBIT_SYNC_MODE:
			(process.env['HAWKBIT_SYNC_MODE'] as 'periodic' | 'on_demand' | 'hybrid') || 'hybrid',
		HAWKBIT_SYNC_INTERVAL_SEC: process.env['HAWKBIT_SYNC_INTERVAL_SEC']
			? Number(process.env['HAWKBIT_SYNC_INTERVAL_SEC'])
			: undefined,
		HAWKBIT_SYNC_STALE_SEC: process.env['HAWKBIT_SYNC_STALE_SEC']
			? Number(process.env['HAWKBIT_SYNC_STALE_SEC'])
			: undefined,
		HAWKBIT_SYNC_ACTIVE_WINDOW_SEC: process.env['HAWKBIT_SYNC_ACTIVE_WINDOW_SEC']
			? Number(process.env['HAWKBIT_SYNC_ACTIVE_WINDOW_SEC'])
			: undefined,
		ARTIFACT_MAX_SIZE_MB: process.env['ARTIFACT_MAX_SIZE_MB']
			? Number(process.env['ARTIFACT_MAX_SIZE_MB'])
			: 50,
		SUPER_ADMIN_EMAILS: parseStringArray(process.env['SUPER_ADMIN_EMAILS']),
		SSE_ENABLED: process.env['SSE_ENABLED'] !== 'false',
		SSE_HEARTBEAT_SEC: process.env['SSE_HEARTBEAT_SEC']
			? Number(process.env['SSE_HEARTBEAT_SEC'])
			: undefined,
		SSE_MAX_CONNECTIONS_PER_COMPANY: process.env['SSE_MAX_CONNECTIONS_PER_COMPANY']
			? Number(process.env['SSE_MAX_CONNECTIONS_PER_COMPANY'])
			: undefined,
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
		OBS_CONNECTIONS_RETENTION_DAYS: process.env['OBS_CONNECTIONS_RETENTION_DAYS']
			? Number(process.env['OBS_CONNECTIONS_RETENTION_DAYS'])
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
