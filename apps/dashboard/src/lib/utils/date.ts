import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

/**
 * Date formatting helpers (pt-BR).
 */

function toDate(value: string | number | Date | null | undefined): Date | null {
	if (value === null || value === undefined || value === '') return null;
	if (value instanceof Date) return value;
	if (typeof value === 'number') return new Date(value);
	try {
		return parseISO(String(value));
	} catch {
		return null;
	}
}

export function formatDateTime(
	value: string | number | Date | null | undefined,
): string {
	const d = toDate(value);
	if (!d) return '—';
	return format(d, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
}

export function formatDate(
	value: string | number | Date | null | undefined,
): string {
	const d = toDate(value);
	if (!d) return '—';
	return format(d, 'dd/MM/yyyy', { locale: ptBR });
}

export function formatRelative(
	value: string | number | Date | null | undefined,
): string {
	const d = toDate(value);
	if (!d) return 'nunca';
	return formatDistanceToNow(d, { addSuffix: true, locale: ptBR });
}
