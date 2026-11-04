'use client';

import s from './app.module.css';

/**
 * WaffleChart — proportional distribution grid (docs/dashboard-v3-refinement-plan.md §15).
 * Cells are PROPORTIONAL (one cell ≈ 1% of the total), not identity: with 40 targets
 * one cell represents 0.4 device. The legend carries exact counts; per-device
 * inspection stays in the linked list — this component never claims one cell = one device.
 */

export interface WaffleCategory {
	key: string;
	label: string;
	value: number;
	color: string;
}

const CELLS = 100;

export function WaffleChart({
	data,
	selected,
	onSelect,
	'aria-label': ariaLabel = 'Distribuição por estado',
}: {
	data: WaffleCategory[];
	selected?: string | null;
	onSelect?: (key: string | null) => void;
	'aria-label'?: string;
}) {
	const total = data.reduce((sum, c) => sum + c.value, 0);

	// Cells per category, proportional; remainder goes to the largest bucket.
	const cells = data.map((c) => (total ? Math.round((c.value / total) * CELLS) : 0));
	const drift = CELLS - cells.reduce((a, b) => a + b, 0);
	if (drift !== 0 && cells.length) {
		const largest = cells.indexOf(Math.max(...cells));
		cells[largest] += drift;
	}

	const flat: { category: WaffleCategory; cellStart: number }[] = [];
	data.forEach((category, i) => {
		for (let j = 0; j < cells[i]; j++) flat.push({ category, cellStart: 0 });
	});

	return (
		<div className={s.waffle}>
			<div className={s.waffleGrid} role="img" aria-label={ariaLabel}>
				{flat.map(({ category }, index) => (
					<span
						key={index}
						className={s.waffleCell}
						style={{ background: category.color }}
						data-dim={selected && selected !== category.key ? '' : undefined}
						title={`${category.label}: ${category.value} (${total ? Math.round((category.value / total) * 100) : 0}%)`}
					/>
				))}
			</div>
			<ul className={s.waffleLegend}>
				{data.map((category) => {
					const percent = total ? Math.round((category.value / total) * 100) : 0;
					const isSel = selected === category.key;
					return (
						<li key={category.key}>
							<button
								type="button"
								aria-pressed={isSel}
								onClick={() => onSelect?.(isSel ? null : category.key)}
								className={s.waffleLegendButton}
							>
								<span className={s.waffleDot} style={{ background: category.color }} />
								<span>{category.label}</span>
								<span className={s.waffleCount}>
									{category.value} · {percent}%
								</span>
							</button>
						</li>
					);
				})}
			</ul>
			<p className={s.footnote}>
				Distribuição proporcional — cada célula representa cerca de 1% do total ({total}{' '}
				{total === 1 ? 'dispositivo' : 'dispositivos'}). Clique numa categoria para filtrar a lista.
			</p>
		</div>
	);
}
