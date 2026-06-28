import { type NextRequest, NextResponse } from 'next/server';

/**
 * API Proxy Route Handler — the SINGLE point of communication with the Ninbus API.
 *
 * Why this exists (architecture decision):
 * The dashboard runs at `ninbus.frt.com.br/admin` and the API at
 * `api.ninbus.frt.com.br`. These are different sites, so the Better Auth session
 * cookie (`sameSite: 'lax'`) does NOT travel from the browser to the API
 * directly (cross-site fetch). The browser therefore NEVER calls the API
 * directly. Instead, it calls this same-origin Route Handler, which performs a
 * server-side fetch to the API and repasses the session cookie.
 *
 * This guarantees:
 *  - All dashboard→API traffic goes through ONE audited path (no direct calls).
 *  - The cookie works (server-to-server on the compose network).
 *  - CORS is not an issue (browser only sees same-origin).
 *  - The internal API URL (`http://api:8081`) is never exposed to the browser.
 *
 * Communication is INTERNAL to the Docker compose network via the `api` service
 * name (DNS resolution), never over the public internet.
 */

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://api:8081';

// Headers that must be forwarded from the browser request to the API.
// `origin` is REQUIRED by Better Auth's trustedOrigins check — without it,
// auth endpoints return 403 even with valid credentials.
const FORWARD_REQUEST_HEADERS = [
	'cookie',
	'content-type',
	'accept',
	'authorization',
	'origin',
];

// Headers copied back from the API response to the browser.
const FORWARD_RESPONSE_HEADERS = [
	'content-type',
	'set-cookie',
	'cache-control',
	'etag',
];

export const dynamic = 'force-dynamic';

async function handler(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
	const { path: pathSegments } = await context.params;
	// This Route Handler lives at app/api/[...path], so pathSegments captures
	// everything AFTER /admin/api/. The Ninbus API mounts real endpoints under
	// /api/* (auth, admin, companies, ...), EXCEPT the health check which is at
	// the root /health. We rebuild the API path with the /api prefix so that
	// /admin/api/auth/x → http://api:8081/api/auth/x. The health probe is the
	// only root endpoint and is called as /admin/api/health here for
	// consistency; the API has /health, so we special-case it.
	const joined = pathSegments.join('/');
	const apiPath = joined === 'health' ? 'health' : `api/${joined}`;

	// Preserve the query string.
	const url = new URL(req.url);
	const targetUrl = `${API_INTERNAL_URL}/${apiPath}${url.search}`;

	// Read the request body ONCE for methods that have one (GET/HEAD have none).
	let body: BodyInit | undefined;
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		body = await req.text();
	}

	// Build the upstream request, forwarding only safe headers + the body.
	const upstream = new Request(targetUrl, {
		method: req.method,
		headers: pickHeaders(req.headers, FORWARD_REQUEST_HEADERS),
		body,
		redirect: 'manual',
		// @ts-expect-error duplex is required when streaming a body in undici.
		duplex: body !== undefined ? 'half' : undefined,
	});

	let upstreamRes: Response;
	try {
		upstreamRes = await fetch(upstream);
	} catch {
		// The API is unreachable (network error inside compose). Surface a 503
		// so the dashboard UI can show a clear "service unavailable" state
		// instead of a generic 500.
		return NextResponse.json(
			{
				error: 'Service Unavailable',
				message:
					'The Ninbus API is currently unreachable. Please try again in a moment.',
			},
			{ status: 503 },
		);
	}

	// Relay the response back, copying relevant headers (including set-cookie so
	// the session cookie is set in the browser's same-origin context).
	const resHeaders = new Headers();
	for (const name of FORWARD_RESPONSE_HEADERS) {
		const v = upstreamRes.headers.get(name);
		if (v) resHeaders.set(name, v);
	}
	// set-cookie must be handled explicitly (it can be multi-valued).
	const setCookies = upstreamRes.headers.getSetCookie?.();
	if (setCookies && setCookies.length > 0) {
		for (const c of setCookies) resHeaders.append('set-cookie', c);
	}

	const resBody = await upstreamRes.arrayBuffer();
	return new NextResponse(resBody, {
		status: upstreamRes.status,
		headers: resHeaders,
	});
}

function pickHeaders(src: Headers, names: string[]): Headers {
	const out = new Headers();
	for (const n of names) {
		const v = src.get(n);
		if (v) out.set(n, v);
	}
	return out;
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
