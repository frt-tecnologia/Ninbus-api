'use client';

import { Skeleton } from '@/components/arc/skeleton/skeleton';
import s from '@/components/arc-app/app.module.css';

/**
 * Admin route-segment loading UI — espelha o shell compartilhado pelas telas
 * do admin para que a troca pelo conteúdo real não desloque o layout.
 *
 * Estrutura (mesma ordem das telas):
 *   1. PageHead — título + descrição à esquerda, ação à direita
 *   2. Coleção — barra de filtros + busca, seguida de um lote de linhas
 *
 * As alturas foram calibradas contra as telas reais (Overview, Empresas,
 * Dispositivos, Usuários, Atualizações, Atividade) para minimizar o
 * "salto" ao carregar: título/descrição, botão, filtros e ~8 linhas de
 * tabela é o piso comum a todas elas.
 */
export default function AdminLoading() {
	return (
		<div aria-busy="true" className={s.loading}>
			{/* PageHead — título + descrição à esquerda, ação à direita */}
			<div className="mb-6 flex items-start justify-between gap-4">
				<div className="flex-1 space-y-2">
					<Skeleton lines={1} label="Carregando título da página" />
					<Skeleton lines={1} label="Carregando descrição da página" />
				</div>
				<div className="w-40 shrink-0">
					<Skeleton lines={1} label="Carregando ação da página" />
				</div>
			</div>

			{/* Coleção — barra de filtros e busca + linhas da tabela */}
			<div className="space-y-4">
				<div className="flex flex-wrap items-center gap-3">
					<div className="w-full max-w-md flex-1">
						<Skeleton lines={1} label="Carregando busca" />
					</div>
					<div className="w-32">
						<Skeleton lines={1} label="Carregando filtro" />
					</div>
					<div className="w-32">
						<Skeleton lines={1} label="Carregando filtro" />
					</div>
				</div>
				<Skeleton lines={8} label="Carregando registros" />
			</div>
		</div>
	);
}
