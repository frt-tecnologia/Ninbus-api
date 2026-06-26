/**
 * Reverse-proxy config regression tests.
 *
 * The nginx config (docker/nginx/) and the hawkBit forward-headers
 * (docker-compose.yml) are security-critical: they ensure the hawkBit
 * Management API / UI are never public and that DDI `_links` carry the
 * public host. These tests guard against an accidental regression
 * (e.g. someone un-blocking /rest/v1/ or dropping the forward-headers).
 *
 * They read the config files as text — no app boot, no DB, no containers —
 * so they run in the standard `bun test` suite.
 *
 * Validated empirically against the live Docker stack: see
 * docs/nginx-reverse-proxy-plan.md ("Validação empírica").
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf-8');

const VHOSTS = read('docker/nginx/conf.d/ninbus.conf');
const NGINX_MAIN = read('docker/nginx/nginx.conf');
const DOCKERFILE = read('docker/nginx/Dockerfile');
const COMPOSE = read('docker-compose.yml');

describe('nginx reverse proxy — security posture', () => {
	describe('hawkBit Management API / UI are hard-blocked on the public vhost', () => {
		it('blocks /rest/v1/ with 404', () => {
			// Management API must NEVER be public — the API reaches it on the
			// internal Docker network (HAWKBIT_URL=http://hawkbit:8080).
			expect(VHOSTS).toMatch(/location\s+\/rest\/v1\/\s*\{\s*return\s+404\s*;?\s*\}/);
		});

		it('blocks the admin UI login + system paths', () => {
			expect(VHOSTS).toMatch(/location\s*=\s*\/login\s*\{\s*return\s+404\s*;?\s*\}/);
			expect(VHOSTS).toMatch(/location\s+\/system\/\s*\{\s*return\s+404\s*;?\s*\}/);
		});
	});

	describe('only the DDI path reaches hawkBit', () => {
		it('routes /<tenant>/controller/v1/ to the hawkBit backend', () => {
			expect(VHOSTS).toMatch(/location\s+~\s*\^\/\[\^\/\]\+\/controller\/v1\/\s*\{/);
			// Dynamic resolution: `set $backend_ddi; proxy_pass http://$backend_ddi;`
			expect(VHOSTS).toContain('set $backend_ddi "hawkbit:8080";');
			expect(VHOSTS).toContain('proxy_pass http://$backend_ddi;');
		});

		it('uses Docker service names (not localhost) for backends', () => {
			// Principle: inter-service URLs use compose service names.
			expect(VHOSTS).toContain('set $backend_api "api:8081";');
			expect(VHOSTS).toContain('set $backend_ddi "hawkbit:8080";');
			expect(VHOSTS).not.toContain('localhost:8081');
			expect(VHOSTS).not.toContain('localhost:8080');
		});

		it('resolves backends dynamically via Docker DNS (no static upstreams)', () => {
			// nginx open-source resolves `upstream {}` hostnames at startup, which
			// races the Docker DNS and aborts with "host not found in upstream".
			// Dynamic resolution via resolver decouples proxy start from backend
			// readiness and survives backend restarts.
			expect(VHOSTS).toMatch(/resolver\s+127\.0\.0\.11\s+valid=30s\s+ipv6=off\s*;/);
			expect(VHOSTS).not.toMatch(/^\s*upstream\s/m);
		});

		it('applies per-IP rate limiting to the DDI (brute-force guard)', () => {
			expect(NGINX_MAIN).toContain('limit_req_zone');
			expect(VHOSTS).toMatch(/limit_req\s+zone=ddi/);
		});
	});

	describe('DDI forward-headers (devices can follow _links)', () => {
		// Without these, hawkBit builds _links with the internal hostname
		// `hawkbit:8080` and devices cannot resolve them. Validated empirically:
		// DDI poll through nginx returns _links with hb.ninbus.frt.com.br.
		it('sends Host + X-Forwarded-Proto/Host/Port to the DDI backend', () => {
			expect(VHOSTS).toContain('proxy_set_header Host');
			expect(VHOSTS).toContain('proxy_set_header X-Forwarded-Proto');
			expect(VHOSTS).toContain('proxy_set_header X-Forwarded-Host');
			expect(VHOSTS).toContain('proxy_set_header X-Forwarded-Port');
		});

		it('enables forward-headers on the hawkBit container (Spring)', () => {
			expect(COMPOSE).toContain('SERVER_FORWARD_HEADERS_STRATEGY: framework');
		});
	});

	describe('name-based virtual hosting over a single public IP', () => {
		it('defines the three expected vhosts by server_name', () => {
			expect(VHOSTS).toContain('server_name api.ninbus.frt.com.br');
			expect(VHOSTS).toContain('server_name ninbus.frt.com.br');
			expect(VHOSTS).toContain('server_name hb.ninbus.frt.com.br');
		});

		it('marks one vhost as default_server (deterministic Host routing)', () => {
			expect(VHOSTS).toMatch(/listen\s+80\s+default_server\s*;/);
		});
	});

	describe('transitional (zero-downtime) deployment', () => {
		it('keeps the API on HTTP (no active :443 — TLS is a later phase)', () => {
			const activeSsl = VHOSTS.split('\n').filter((l) => /^\s*listen\s+443\s+ssl/.test(l));
			expect(activeSsl).toHaveLength(0);
		});

		it('keeps the api port published (rollback safety until cutover)', () => {
			// The api port is removed only in Fase 6 after the device cutover.
			expect(COMPOSE).toMatch(/"\$\{PORT:-8081\}:\$\{PORT:-8081\}"/);
		});

		it('removes the hawkBit public port (DDI now served by nginx)', () => {
			// Fase 5 cutover: the :8080 host port belongs to nginx (Opção C).
			// hawkBit stays reachable internally as http://hawkbit:8080.
			expect(COMPOSE).toMatch(/#\s+Public port REMOVED/);
			expect(COMPOSE).toMatch(/#\s+- "\$\{HAWKBIT_PORT:-8080\}:8080"/);
		});

		it('runs the nginx image default user scheme (master root, workers nginx)', () => {
			expect(DOCKERFILE).toMatch(/^FROM\s+nginx:\d/m);
			// We do NOT force USER nginx: that breaks /var/cache/nginx creation.
			expect(DOCKERFILE).not.toMatch(/^USER\s/m);
		});

		it('healthcheck probes IPv4 127.0.0.1 (localhost resolves to IPv6 ::1)', () => {
			expect(DOCKERFILE).toContain('http://127.0.0.1/health');
			expect(DOCKERFILE).not.toContain('http://localhost/health');
		});
	});
});
