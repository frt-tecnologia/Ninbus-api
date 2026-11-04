'use client';
/**
 * Users — tabs Contas × Convites (designations), group filter, search, and
 * the user detail drawer (?detail=) with the person's real audit trail.
 * Invites drawer (?invite=) with cancel. All REAL.
 */
import { Plus } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs';
import s from '@/components/arc-app/app.module.css';
import { InviteDetails, UserDetails } from '@/components/arc-app/details';
import { MemberForm } from '@/components/arc-app/forms';
import { Guard, PageHead } from '@/components/arc-app/page-head';
import {
	Button,
	Collection,
	roleLabel,
	roleOptions,
	Status,
	Surface,
	stamp,
} from '@/components/arc-app/primitives';
import { companyService, designationService, userService } from '@/lib/api';
import { qk } from '@/lib/cache/keys';
import { useQuery } from '@/lib/cache/use-query';

export default function UsersPage() {
	const router = useRouter();
	const search = useSearchParams();
	const users = useQuery(
		qk.adminUsers,
		React.useCallback(() => userService.list(), []),
	);
	const designations = useQuery(
		qk.adminInvites,
		React.useCallback(() => designationService.listPending(), []),
	);
	const companies = useQuery(
		qk.adminCompanies,
		React.useCallback(() => companyService.list(), []),
		{ sync: false },
	);

	const [detail, setDetail] = React.useState<string | null>(search.get('detail'));
	const [invite, setInvite] = React.useState<string | null>(search.get('invite'));
	const [form, setForm] = React.useState(false);

	const userList = users.data?.data ?? [];
	const inviteList = designations.data?.data ?? [];
	const companyList = companies.data?.data ?? [];
	const user = userList.find((u) => u.id === detail) ?? null;
	const invitation = inviteList.find((i) => i.id === invite) ?? null;

	return (
		<>
			<PageHead
				title="Usuários"
				description="Pessoas, papéis e convites organizados por empresa."
				actions={
					<Button onClick={() => setForm(true)}>
						<Plus size={17} />
						Adicionar pessoa
					</Button>
				}
			/>
			<Guard loading={users.loading} error={users.error} onRetry={users.refetch}>
				<Tabs defaultValue="accounts">
					<TabsList aria-label="Contas e convites">
						<TabsTrigger value="accounts">Contas ({userList.length})</TabsTrigger>
						<TabsTrigger value="invites">
							Convites{' '}
							{inviteList.filter((i) => !i.claimedAt).length > 0 &&
								`(${inviteList.filter((i) => !i.claimedAt).length})`}
						</TabsTrigger>
					</TabsList>
					<TabsContent value="accounts">
						<Collection
							label="Pessoas"
							rows={userList.map((x) => ({ ...x }))}
							onOpenRow={(r) => setDetail(String(r.id))}
							fields={[
								{ id: 'companyCount', label: 'Empresas', options: ['0', '1', '2', '3+'] },
								{ id: 'isSuperAdmin', label: 'Acesso', options: ['true', 'false'] },
							]}
							columns={[
								{
									key: 'name',
									label: 'Pessoa',
									render: (_, r) => (
										<button type="button" className={s.link} onClick={() => setDetail(r.id)}>
											{r.name || r.email}
											<span className={s.cellSub}>{r.email}</span>
										</button>
									),
								},
								{ key: 'companyCount', label: 'Empresas' },
								{
									key: 'isSuperAdmin',
									label: 'Acesso',
									render: (v) =>
										v ? <Status value="active" /> : <span className={s.muted}>Empresa</span>,
								},
								{ key: 'createdAt', label: 'Criada em', render: (v) => stamp(String(v)) },
							]}
						/>
					</TabsContent>
					<TabsContent value="invites">
						<Collection
							label="Convites"
							rows={inviteList.map((i) => ({ ...i, role: i.role }))}
							onOpenRow={(r) => setInvite(String(r.id))}
							dateKey="createdAt"
							fields={[
								{ id: 'companyName', label: 'Empresa', options: companyList.map((c) => c.name) },
								{ id: 'role', label: 'Papel', options: roleOptions.map((r) => r.value) },
							]}
							columns={[
								{
									key: 'email',
									label: 'E-mail',
									render: (_, r) => (
										<button type="button" className={s.link} onClick={() => setInvite(r.id)}>
											{r.email}
										</button>
									),
								},
								{ key: 'companyName', label: 'Empresa' },
								{ key: 'role', label: 'Papel', render: (v) => roleLabel(String(v)) },
								{
									key: 'claimedAt',
									label: 'Estado',
									render: (v) => <Status value={v ? 'accepted' : 'pending'} />,
								},
								{ key: 'createdAt', label: 'Registrado em', render: (v) => stamp(String(v)) },
							]}
						/>
					</TabsContent>
				</Tabs>
			</Guard>

			<Surface
				open={!!detail}
				onClose={() => {
					setDetail(null);
					if (search.get('detail')) router.replace('/users');
				}}
				title={user?.name || user?.email || 'Pessoa'}
				description={user?.email ?? ''}
			>
				{user && <UserDetails user={user} />}
			</Surface>

			<Surface
				open={!!invite}
				onClose={() => {
					setInvite(null);
					if (search.get('invite')) router.replace('/users');
				}}
				title="Detalhes do convite"
			>
				{invitation && (
					<InviteDetails invite={invitation} companies={companyList} done={() => setInvite(null)} />
				)}
			</Surface>

			<Surface
				open={form}
				onClose={() => setForm(false)}
				title="Adicionar pessoa ou convite"
				description="O vínculo é criado imediatamente para contas existentes; caso contrário fica pendente até o cadastro."
			>
				<MemberForm companies={companyList} done={() => setForm(false)} />
			</Surface>
		</>
	);
}
