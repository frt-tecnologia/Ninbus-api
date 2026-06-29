import type { NextConfig } from 'next';

/**
 * Next.js configuration for the Ninbus Admin Dashboard.
 *
 * basePath: '/admin' — the dashboard is served at ninbus.frt.com.br/admin via
 * the nginx reverse-proxy (location /admin/ → dashboard:3001). All internal
 * links/assets are auto-prefixed, so we write routes as if at root.
 *
 * output: 'standalone' — produces a self-contained .next/standalone dir for the
 * Docker production image (~120MB, no node_modules needed at runtime).
 */
const nextConfig: NextConfig = {
	basePath: '/admin',
	output: 'standalone',
	reactStrictMode: true,
	// The dashboard never talks to the API directly from the browser (cross-origin
	// cookie). All API calls go through the Route Handler proxy at /api/[...path].
	// No rewrites needed — the proxy handles forwarding to http://api:8081.
};

export default nextConfig;
