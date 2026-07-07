'use client';

import { DesignationTable } from '@/components/domain/companies/designation-table';
import { InviteUserDialog } from '@/components/domain/users/invite-user-dialog';
import { UserTable } from '@/components/domain/users/user-table';
import { PageHeader } from '@/components/layout/page-header';
import { SearchField, Section, Toolbar } from '@/components/system';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFetch } from '@/hooks/useFetch';
import { designationService, userService } from '@/lib/api';
import { useCallback, useMemo, useState } from 'react';
type GroupFilter = 'all' | 'with-company' | 'no-company' | 'superadmin';

const GROUP_LABELS: Record<GroupFilter, string> = {
	all: 'Todos',
	'with-company': 'Com empresa',
	'no-company': 'Sem empresa',
	superadmin: 'Super admins',
};

/**
 * Users page — enriched: search + filters (group) + tabs separating
 * registered accounts from pending invitations (which activate on sign-up).
 *
 * Reativity: a single useFetch per data source; filtering is client-side
 * (memoized) so it stays instant. The global data-event bus refreshes tables
 * after any mutation (designation cancel, etc.) automatically.
 */
export default function UsersPage() {
	const users = useFetch(useCallback(() => userService.list(), []));
	const designations = useFetch(useCallback(() => designationService.listPending(), []));

	const [search, setSearch] = useState('');
	const [group, setGroup] = useState<GroupFilter>('all');

	// Apply group filter (company-count based). Search is delegated to the
	// UserTable's DataTable (now wired to actually filter).
	const filtered = useMemo(() => {
		const list = users.data?.data ?? [];
		return list.filter((u) => {
			if (group === 'with-company') return u.companyCount > 0 && !u.isSuperAdmin;
			if (group === 'no-company') return u.companyCount === 0 && !u.isSuperAdmin;
			if (group === 'superadmin') return u.isSuperAdmin;
			return true;
		});
	}, [users.data, group]);

	const pendingCount = designations.data?.data.filter((d) => !d.claimedAt).length ?? 0;

	return (
		<>
			<PageHeader
				title="Usuários"
				description="Contas da plataforma, convites pendentes e vínculos com empresas."
				action={<InviteUserDialog />}
			/>

			<Tabs defaultValue="accounts">
				<TabsList>
					<TabsTrigger value="accounts">Contas ({users.data?.data.length ?? 0})</TabsTrigger>
					<TabsTrigger value="invites">
						Convites pendentes {pendingCount > 0 && `(${pendingCount})`}
					</TabsTrigger>
				</TabsList>

				{/* ── Registered accounts ── */}
				<TabsContent value="accounts" className="mt-4">
					<Section
						flush
						action={
							<Toolbar>
								<SearchField
									value={search}
									onChange={setSearch}
									placeholder="Buscar por nome ou email…"
									className="w-56"
								/>
								<Select value={group} onValueChange={(v) => setGroup(v as GroupFilter)}>
									<SelectTrigger className="h-8 w-40">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{(Object.keys(GROUP_LABELS) as GroupFilter[]).map((g) => (
											<SelectItem key={g} value={g}>
												{GROUP_LABELS[g]}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</Toolbar>
						}
					>
						<UserTable
							users={filtered}
							loading={users.loading}
							error={users.error}
							onRetry={users.refetch}
							search={{
								value: search,
								onChange: setSearch,
								placeholder: 'Buscar por nome ou email…',
							}}
						/>
					</Section>
				</TabsContent>

				{/* ── Pending invitations (activate on sign-up) ── */}
				<TabsContent value="invites" className="mt-4">
					<Section
						title="Convites pendentes"
						description="Emails designados que ativam o acesso ao se cadastrar na plataforma."
						flush
					>
						<DesignationTable />
					</Section>
				</TabsContent>
			</Tabs>
		</>
	);
}
