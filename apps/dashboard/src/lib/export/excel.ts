import * as XLSX from 'xlsx';

/**
 * Excel/Google Sheets export (client-side via SheetJS).
 *
 * Produces a .xlsx that opens in Excel/Google Sheets. Client-side keeps the
 * API free of report deps. Data comes from existing API endpoints.
 */
export interface ExcelColumn<T> {
	header: string;
	accessor: (row: T) => string | number;
}

export interface ExcelOptions {
	fileName: string;
	sheetName?: string;
}

export function exportToExcel<T>(
	rows: T[],
	columns: ExcelColumn<T>[],
	opts: ExcelOptions,
): void {
	const data = rows.map((row) => {
		const obj: Record<string, string | number> = {};
		for (const col of columns) {
			obj[col.header] = col.accessor(row);
		}
		return obj;
	});

	const ws = XLSX.utils.json_to_sheet(data);
	const wb = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(wb, ws, opts.sheetName ?? 'Dados');
	XLSX.writeFile(wb, `${opts.fileName}.xlsx`);
}
