/**
 * Shared authorization helpers for route modules.
 * Avoids repeating company membership checks in every handler.
 */
import { isCompanyMember } from '@modules/companies/service';

export async function checkMembership(
	companyId: string,
	userId: string,
): Promise<{ status: number; body: any } | null> {
	const isMember = await isCompanyMember(companyId, userId);
	if (!isMember) {
		return { status: 403, body: { error: 'Forbidden', message: 'Not a member of this company' } };
	}
	return null;
}
