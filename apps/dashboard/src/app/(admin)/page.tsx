import { redirect } from 'next/navigation';

/**
 * Root redirect → overview. The dashboard is served at basePath '/console'
 * (applied automatically by Next), so visitors land on /console first and are
 * sent to /console/overview (or to /console/auth/login via the middleware/layout
 * guard if not authenticated).
 */
export default function AdminRoot() {
	redirect('/overview');
}
