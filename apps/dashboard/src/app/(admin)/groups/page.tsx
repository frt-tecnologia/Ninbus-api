'use client';
/**
 * Legacy `/groups` — groups (device categories) live inside each company
 * (Eixo D). Redirect to the companies list, the closest meaningful screen.
 */
import { redirect } from 'next/navigation';

export default function GroupsRedirect() {
	redirect('/companies');
}
