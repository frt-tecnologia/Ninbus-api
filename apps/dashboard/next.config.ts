import type { NextConfig } from 'next';

/**
 * Next.js configuration for the Ninbus Dashboard.
 *
 * basePath '/console' — the dashboard is an INTERNAL tool served at
 * ninbus.frt.com.br/console. The path is deliberately NOT the obvious '/admin'
 * (too guessable) and NOT the root '/' (reserved for the future public
 * site). nginx routes /console + /console/* to this container; everything else
 * on the host returns 404 so the dashboard's existence is not advertised.
 *
 * output: 'standalone' — produces a self-contained .next/standalone dir for the
 * Docker production image (~120MB, no node_modules needed at runtime).
 */
const nextConfig: NextConfig = {
	basePath: '/console',
	output: 'standalone',
	reactStrictMode: true,
	// The dashboard never talks to the API directly from the browser (cross-origin
	// cookie). All API calls go through the Route Handler proxy at /api/[...path].
	// No rewrites needed — the proxy handles forwarding to http://api:8081.
};

export default nextConfig;
