import { redirect } from 'next/navigation';

/**
 * Root redirect → overview. The dashboard is served at root (no basePath),
 * so visitors land here first and are sent to the overview (or to login via
 * the middleware/layout guard if not authenticated).
 */
export default function AdminRoot() {
	redirect('/overview');
}
