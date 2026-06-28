import { redirect } from 'next/navigation';

/**
 * Root /admin redirect → overview.
 * (basePath '/admin' means the actual URL is ninbus.frt.com.br/admin)
 */
export default function AdminRoot() {
	redirect('/admin/overview');
}
