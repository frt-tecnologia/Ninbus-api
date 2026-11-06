import type { ReactNode } from 'react';
import { ArcShell } from '@/components/arc-app/shell';
import { requireAdmin } from '@/lib/auth/session';

/**
 * Admin layout — Arc shell over the server-side super-admin guard.
 * Every /console page renders inside <ArcShell> (sidebar + topbar + ⌘K).
 */
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: ReactNode }) {
	const user = await requireAdmin();
	return <ArcShell userEmail={user.email}>{children}</ArcShell>;
}
