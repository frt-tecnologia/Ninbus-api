import { describe, expect, it } from 'bun:test';
import { createApp } from '../src/app';

describe('Health Module', () => {
	const app = createApp();

	it('GET /health returns ok status', async () => {
		const response = await app.handle(new Request('http://localhost/health'));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.status).toBe('ok');
		expect(body.database).toBe('healthy');
		expect(body).toHaveProperty('timestamp');
		expect(body).toHaveProperty('uptime');
		expect(body).toHaveProperty('responseTime');
	});

	it('GET /health returns valid timestamp ISO format', async () => {
		const response = await app.handle(new Request('http://localhost/health'));
		const body = await response.json();

		expect(response.status).toBe(200);
		// Validate ISO timestamp
		const timestamp = new Date(body.timestamp);
		expect(timestamp.getTime()).not.toBeNaN();
	});

	it('GET /health returns numeric uptime', async () => {
		const response = await app.handle(new Request('http://localhost/health'));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(typeof body.uptime).toBe('number');
		expect(body.uptime).toBeGreaterThan(0);
	});

	it('GET /health responseTime ends with ms', async () => {
		const response = await app.handle(new Request('http://localhost/health'));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.responseTime).toMatch(/^\d+ms$/);
	});

	it('GET /health status is ok or degraded', async () => {
		const response = await app.handle(new Request('http://localhost/health'));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(['ok', 'degraded']).toContain(body.status);
	});
});
