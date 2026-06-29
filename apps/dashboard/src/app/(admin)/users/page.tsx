'use client';

import { useCallback, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { UserTable } from '@/components/domain/users/user-table';
import { useFetch } from '@/hooks/useFetch';
import { userService } from '@/lib/api';

export default function UsersPage() {
	const users = useFetch(useCallback(() => userService.list(), []));
	const [search, setSearch] = useState('');
	return (
		<>
			<PageHeader
				title="Usuários"
				description="Contas da plataforma. Promoção a super admin é controlada por SUPER_ADMIN_EMAILS."
			/>
			<UserTable
				users={users.data?.data ?? []}
				loading={users.loading}
				error={users.error}
				onRetry={users.refetch}
				search={{ value: search, onChange: setSearch, placeholder: 'Buscar por nome ou email…' }}
			/>
		</>
	);
}
