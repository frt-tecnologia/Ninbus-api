import { describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';
import { LRUCache } from 'lru-cache';
import { createRateLimiter, getClientIP } from '../src/common/middleware/rate-limiter';

const WINDOW_MS = 60_000;
const EDGE_IP = '203.0.113.50';
const SPOOFED_IPS = ['10.0.0.1', '10.0.0.2', '10.9.9.9'];

describe('Rate limiter client IP (S1)', () => {
	describe('getClientIP', () => {
		it('returns the last XFF entry, ignoring spoofed leading entries', () => {
			const req = new Request('http://localhost/x', {
				headers: { 'x-forwarded-for': `1.2.3.4, 5.6.7.8, ${EDGE_IP}` },
			});
			expect(getClientIP(req)).toBe(EDGE_IP);
		});

		it('returns the single entry of a one-hop chain', () => {
			const req = new Request('http://localhost/x', {
				headers: { 'x-forwarded-for': '198.51.100.7' },
			});
			expect(getClientIP(req)).toBe('198.51.100.7');
		});

		it('trims whitespace around entries', () => {
			const req = new Request('http://localhost/x', {
				headers: { 'x-forwarded-for': `1.2.3.4,  ${EDGE_IP} ` },
			});
			expect(getClientIP(req)).toBe(EDGE_IP);
		});

		it('falls back to X-Real-IP when XFF is absent', () => {
			const req = new Request('http://localhost/x', {
				headers: { 'x-real-ip': '203.0.113.20' },
			});
			expect(getClientIP(req)).toBe('203.0.113.20');
		});

		it('falls back to unknown when no proxy headers exist', () => {
			expect(getClientIP(new Request('http://localhost/x'))).toBe('unknown');
		});
	});

	describe('createRateLimiter spoof resistance', () => {
		const requestWithIp = (ip: string) =>
			new Request('http://localhost/limited', {
				headers: { 'x-forwarded-for': ip },
			});

		function makeApp(max = 3, skip?: (req: Request) => boolean) {
			const cache = new LRUCache<string, number[]>({ max: 100, ttl: WINDOW_MS });
			return new Elysia()
				.use(createRateLimiter({ max, windowMs: WINDOW_MS, cache, skip }))
				.get('/limited', () => 'ok');
		}

		it('blocks despite a rotating spoofed first XFF entry from the same edge IP', async () => {
			const app = makeApp(3);
			for (const spoofedIp of SPOOFED_IPS) {
				const res = await app.handle(requestWithIp(`${spoofedIp}, ${EDGE_IP}`));
				expect(res.status).toBe(200);
			}
			const blocked = await app.handle(requestWithIp(`10.8.8.8, ${EDGE_IP}`));
			expect(blocked.status).toBe(429);
		});

		it('buckets different real edge IPs independently', async () => {
			const app = makeApp(1);
			for (let lastOctet = 1; lastOctet <= 5; lastOctet++) {
				const res = await app.handle(requestWithIp(`203.0.113.${lastOctet}`));
				expect(res.status).toBe(200);
			}
		});

		it('skips requests matching the skip rule', async () => {
			const skipOptions = (req: Request) => req.method === 'OPTIONS';
			const app = makeApp(1, skipOptions).options('/limited', () => 'ok');
			for (let attempt = 0; attempt < 3; attempt++) {
				const res = await app.handle(
					new Request('http://localhost/limited', {
						method: 'OPTIONS',
						headers: { 'x-forwarded-for': '203.0.113.99' },
					}),
				);
				expect(res.status).toBe(200);
			}
		});
	});
});
