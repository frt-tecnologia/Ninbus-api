'use client';

import { useCallback, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Maximize2, Minimize2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Section, Id, Signal, Empty } from '@/components/system';
import { ActivityFeed } from '@/components/domain/observability/activity-feed';
import { Button } from '@/components/ui/button';
import { useFetch } from '@/hooks/useFetch';
import { userService, observabilityService } from '@/lib/api';
import type { ActivityLogEntry } from '@/lib/api';
import type { SignalToken } from '@/lib/design/tokens';

/**
 * User detail — opened when clicking a user name in the users table.
 *
 * Shows the user's identity card + their audit trail (all actions THEY
 * performed across the platform), filtered via GET /admin/activity?actorUserId.
 * The activity section has a max/min toggle to expand the log for easier
 * reading.
 */
export default function UserDetailPage() {
	const params = useParams<{ id: string }>();
	const router = useRouter();
	const userId = params.id;

	// Users API has no single-resource GET; fetch the list and find by id.
	// Acceptable for a platform with a bounded user count.
	const users = useFetch(useCallback(() => userService.list(), []), []);
	const user = useMemo(
		() => (users.data?.data ?? []).find((u) => u.id === userId) ?? null,
		[users.data, userId],
	);

	// This user's audit trail.
	const activity = useFetch(
		useCallback(
			() => observabilityService.activity({ actorUserId: userId, limit: 100 }),
			[userId],
		),
		[userId],
	);
	const [expanded, setExpanded] = useState(false);

	const roleToken: SignalToken = user?.isSuperAdmin
		? { tone: 'info', shape: 'diamond', label: 'Super admin' }
		: user && user.companyCount > 0
			? { tone: 'ok', shape: 'dot', label: 'Membro' }
			: { tone: 'idle', shape: 'ring', label: 'Sem empresa' };

	const entries = (activity.data?.data ?? []) as ActivityLogEntry[];

	return (
		<>
			<PageHeader
				title={(user?.name ?? user?.email) ?? 'Carregando…'}
				description={user?.email}
				action={
					<Button variant="outline" size="sm" onClick={() => router.push('/users')} className="h-8">
						<ArrowLeft className="mr-1.5 h-4 w-4" />
						Voltar
					</Button>
				}
			/>

			{users.error ? (
				<p className="py-12 text-center text-sm text-muted-foreground">
					Usuário não encontrado.
				</p>
			) : (
				<div className="space-y-4">
					{/* Identity card */}
					<Section title="Identidade" description="Dados da conta.">
						<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
							<Field label="Nome" value={user?.name ?? '—'} />
							<Field label="Email" value={user?.email ?? '—'} mono />
							<div>
								<span className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">Função</span>
								<div className="mt-1">{user && <Signal token={roleToken} size="sm" />}</div>
							</div>
							<div>
								<span className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">Empresas</span>
								<div className="mt-1 font-mono text-sm tabular-nums">{user?.companyCount ?? 0}</div>
							</div>
						</div>
						{user && (
							<div className="mt-3">
								<Id value={user.id} className="text-[10px] text-muted-foreground" />
							</div>
						)}
					</Section>

					{/* Activity log (this user's actions) */}
					<Section
						title="Atividade"
						description="Ações realizadas por este usuário em toda a plataforma."
						action={
							<Button
								variant="ghost"
								size="sm"
								className="h-8 gap-1.5"
								onClick={() => setExpanded((v) => !v)}
								aria-label={expanded ? 'Minimizar' : 'Maximizar'}
							>
								{expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
								{expanded ? 'Minimizar' : 'Maximizar'}
							</Button>
						}
					>
						<div
							style={{ maxHeight: expanded ? '70vh' : '20rem' }}
							className="overflow-y-auto transition-all duration-300"
						>
							{activity.error ? (
								<p className="py-8 text-center text-xs text-muted-foreground">
									Falha ao carregar a atividade.
								</p>
							) : entries.length === 0 && !activity.loading ? (
								<Empty title="Sem atividade" description="Este usuário ainda não realizou ações." />
							) : (
								<ActivityFeed entries={entries} loading={activity.loading} />
							)}
						</div>
					</Section>
				</div>
			)}
		</>
	);
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
	return (
		<div>
			<span className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">{label}</span>
			<div className={`mt-1 text-sm text-foreground ${mono ? 'font-mono' : ''}`}>{value}</div>
		</div>
	);
}
