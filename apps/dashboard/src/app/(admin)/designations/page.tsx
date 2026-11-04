import { redirect } from 'next/navigation';

/** Designations live in the Users page (Convites tab) under the Arc console. */
export default function DesignationsPage() {
	redirect('/users');
}
