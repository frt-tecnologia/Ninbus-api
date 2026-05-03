/**
 * Mender Gateway configuration — thin typed accessor over env.
 *
 * All values come from env.ts (single source of truth).
 * No process.env reads here — only typed access to the validated `env` object.
 */
import { env } from './env';

export const menderConfig = {
	get enabled(): boolean {
		return env.MENDER_ENABLED;
	},
	get baseUrl(): string {
		if (!env.MENDER_GATEWAY_URL) {
			throw new Error(
				'[MENDER] MENDER_GATEWAY_URL is required when MENDER_ENABLED=true.\n' +
					'Set it in your .env file.\n' +
					'See: mender-server/backend/docs/ARCHITECTURE_GUIDE.md',
			);
		}
		return env.MENDER_GATEWAY_URL;
	},
	get pat(): string {
		if (!env.MENDER_PAT) {
			throw new Error(
				'[MENDER] MENDER_PAT is required when MENDER_ENABLED=true.\n' +
					'Obtain via: POST /api/management/v1/useradm/settings/tokens',
			);
		}
		return env.MENDER_PAT;
	},
	get timeout(): number {
		return env.MENDER_TIMEOUT_MS ?? 30000;
	},
	get hostOverride(): string | undefined {
		return env.MENDER_HOST_OVERRIDE;
	},
	get skipTls(): boolean {
		return env.MENDER_SKIP_TLS;
	},
	get tenantToken(): string | undefined {
		return env.MENDER_TENANT_TOKEN;
	},
};
