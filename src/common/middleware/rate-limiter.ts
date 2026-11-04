import { env } from '@common/config/env';
import { appLogger } from '@common/logger';
import { Elysia } from 'elysia';
import { LRUCache } from 'lru-cache';

const globalCache = new LRUCache<string, number[]>({
	max: 10000,
	ttl: env.RATE_LIMIT_WINDOW_MS ?? 60000,
});

const authCache = new LRUCache<string, number[]>({
	max: 1000,
	ttl: env.AUTH_RATE_LIMIT_WINDOW_MS ?? 60000,
});

export function getClientIP(req: Request): string {
	const edgeAppendedIp = req.headers.get('x-forwarded-for')?.split(',').pop()?.trim();
	return edgeAppendedIp || req.headers.get('x-real-ip')?.trim() || 'unknown';
}

export const createRateLimiter = (options: {
	max: number;
	windowMs: number;
	cache: LRUCache<string, number[]>;
	skip?: (req: Request) => boolean;
}) => {
	return new Elysia().onRequest(({ request, set }) => {
		if (options.skip?.(request)) return;

		const ip = getClientIP(request);
		const now = Date.now();
		const timestamps = options.cache.get(ip) || [];

		const valid = timestamps.filter((ts) => now - ts < options.windowMs);
		valid.push(now);

		if (valid.length > options.max) {
			if (env.NODE_ENV === 'development') {
				appLogger.warn(
					`[RATE_LIMIT] IP ${ip} blocked (limit: ${options.max}/${options.windowMs}ms)`,
				);
			}
			set.status = 429;
			return {
				error: 'Too Many Requests',
				message: 'Rate limit exceeded. Please try again later.',
			};
		}

		options.cache.set(ip, valid);
	});
};

const limiterDisabled = () => !env.ENABLE_RATE_LIMITER;

const skipsAuthAndHealth = (req: Request) => {
	if (req.method === 'OPTIONS') return true;
	const path = new URL(req.url).pathname;
	return path === '/health' || path.startsWith('/api/auth');
};

export const globalRateLimit = createRateLimiter({
	max: env.RATE_LIMIT_MAX ?? 150,
	windowMs: env.RATE_LIMIT_WINDOW_MS ?? 60000,
	cache: globalCache,
	skip: (req) => limiterDisabled() || skipsAuthAndHealth(req),
});

export const authRateLimit = createRateLimiter({
	max: env.AUTH_RATE_LIMIT_MAX ?? 20,
	windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS ?? 60000,
	cache: authCache,
	skip: limiterDisabled,
});
