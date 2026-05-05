/**
 * hawkBit Update Server configuration — thin typed accessor over env.
 *
 * All values come from env.ts (single source of truth).
 * No process.env reads here — only typed access to the validated `env` object.
 *
 * hawkBit uses HTTP Basic Auth for the Management API.
 * The DDI (Device Integration) API uses target security tokens.
 */
import { env } from './env';

export const hawkbitConfig = {
	get enabled(): boolean {
		return env.HAWKBIT_ENABLED;
	},
	get baseUrl(): string {
		if (!env.HAWKBIT_URL) {
			throw new Error(
				'[HAWKBIT] HAWKBIT_URL is required when HAWKBIT_ENABLED=true.\n' +
					'Set it in your .env file (e.g., http://localhost:8080).',
			);
		}
		return env.HAWKBIT_URL;
	},
	get username(): string {
		if (!env.HAWKBIT_USERNAME) {
			throw new Error(
				'[HAWKBIT] HAWKBIT_USERNAME is required when HAWKBIT_ENABLED=true.\n' +
					'Default hawkBit admin credentials: admin / admin.',
			);
		}
		return env.HAWKBIT_USERNAME;
	},
	get password(): string {
		if (!env.HAWKBIT_PASSWORD) {
			throw new Error('[HAWKBIT] HAWKBIT_PASSWORD is required when HAWKBIT_ENABLED=true.');
		}
		return env.HAWKBIT_PASSWORD;
	},
	get timeout(): number {
		return env.HAWKBIT_TIMEOUT_MS ?? 30000;
	},
	get skipTls(): boolean {
		return env.HAWKBIT_SKIP_TLS;
	},
};
