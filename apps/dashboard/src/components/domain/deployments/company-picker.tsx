'use client';

import * as React from 'react';
import { Check, ChevronsUpDown, Layers, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Company } from '@/types/domain';
import { Button } from '@/components/ui/button';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/components/ui/popover';
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from '@/components/ui/command';

/**
 * <CompanyPicker> — a searchable company selector with an explicit
 * "Todas as empresas" (grouped) option.
 *
 * Replaces the bare <Select> on the deployments page so the operator can:
 *  - see the aggregate (all-companies) view, OR
 *  - type to find one company among many.
 *
 * `value` is the selected companyId, or `''` for the grouped (all) view.
 */
const ALL_VALUE = '';

export function CompanyPicker({
	companies,
	value,
	onChange,
	loading = false,
	className,
}: {
	companies: Company[];
	value: string;
	onChange: (companyId: string) => void;
	loading?: boolean;
	className?: string;
}) {
	const [open, setOpen] = React.useState(false);
	const selected = companies.find((c) => c.id === value) ?? null;
	const isAll = value === ALL_VALUE;

	const label = loading
		? 'Carregando…'
		: isAll
			? 'Todas as empresas'
			: selected?.name ?? 'Selecionar empresa';

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					role="combobox"
					aria-expanded={open}
					className={cn('h-9 w-full justify-between font-normal', className)}
				>
					<span className="flex min-w-0 items-center gap-2">
						{isAll ? (
							<Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
						) : (
							<Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
						)}
						<span className="truncate">{label}</span>
					</span>
					<ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-[20rem] p-0" align="start">
				<Command>
					<CommandInput placeholder="Buscar empresa…" />
					<CommandList>
						<CommandEmpty>Nenhuma empresa encontrada.</CommandEmpty>
						<CommandGroup heading="Agrupado">
							<CommandItem
								value="__all__"
								onSelect={() => {
									onChange(ALL_VALUE);
									setOpen(false);
								}}
							>
								<Check
									className={cn(
										'mr-2 h-4 w-4',
										isAll ? 'opacity-100' : 'opacity-0',
									)}
								/>
								<Layers className="mr-2 h-4 w-4 text-muted-foreground" />
								Todas as empresas
							</CommandItem>
						</CommandGroup>
						<CommandGroup heading="Empresas">
							{companies.map((c) => (
								<CommandItem
									key={c.id}
									value={`${c.name} ${c.id}`}
									onSelect={() => {
										onChange(c.id);
										setOpen(false);
									}}
								>
									<Check
										className={cn(
											'mr-2 h-4 w-4',
											value === c.id ? 'opacity-100' : 'opacity-0',
										)}
									/>
									<Building2 className="mr-2 h-4 w-4 text-muted-foreground" />
									<span className="truncate">{c.name}</span>
									<span className="ml-auto font-mono text-[0.65rem] text-muted-foreground">
										{c.deviceCount}
									</span>
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
