import { expect, test } from 'bun:test';
import { dragRange, fitRange } from './range-model';

const domain = [0, 100] as const;
test('mantém o intervalo e a duração dentro do domínio', () => {
	expect(fitRange([-20, 20], domain, 10)).toEqual([0, 40]);
	expect(fitRange([80, 120], domain, 10)).toEqual([60, 100]);
	expect(fitRange([0, 200], domain, 10)).toEqual([0, 100]);
});
test('corrige valores inválidos e aplica duração mínima', () => {
	expect(fitRange([NaN, NaN], domain, 10)).toEqual([0, 100]);
	expect(fitRange([50, 50], domain, 10)).toEqual([50, 60]);
	expect(fitRange([0, 100], domain, 200)).toEqual([0, 100]);
});
test('alças não cruzam nem ultrapassam o histórico', () => {
	expect(dragRange('start', [20, 60], 20, 90, domain, 10)).toEqual([50, 60]);
	expect(dragRange('end', [20, 60], 60, -10, domain, 10)).toEqual([20, 30]);
	expect(dragRange('end', [20, 60], 60, 150, domain, 10)).toEqual([20, 100]);
});
test('mover preserva a duração nos limites', () => {
	expect(dragRange('pan', [20, 60], 30, 120, domain, 10)).toEqual([60, 100]);
	expect(dragRange('pan', [20, 60], 30, -100, domain, 10)).toEqual([0, 40]);
});
test('permite criar uma seleção em ambas as direções', () => {
	expect(dragRange('new', [20, 60], 30, 70, domain, 10)).toEqual([30, 70]);
	expect(dragRange('new', [20, 60], 70, 30, domain, 10)).toEqual([30, 70]);
});

test('arrasto produz milissegundos inteiros inclusive em timestamps reais', () => {
	const first = 1793235600000,
		last = 1793826000000;
	const next = dragRange(
		'start',
		[1793761200000, last],
		1793761200000,
		1793722671790.123,
		[first, last],
		60000,
	);
	expect(next).toEqual([1793722671790, last]);
	expect(next.every(Number.isInteger)).toBe(true);
});
