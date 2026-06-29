import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/**
 * PDF export (client-side via jsPDF + autotable).
 *
 * Why client-side: keeps the API free of report-generation load, lets the user
 * preview/customize before saving, and avoids shipping PDF deps in the API
 * image. Data comes from existing API endpoints; this only formats it.
 */
export interface PdfColumn<T> {
	header: string;
	accessor: (row: T) => string | number;
}

export interface ExportOptions {
	title: string;
	fileName: string;
	subtitle?: string;
}

export function exportToPdf<T>(
	rows: T[],
	columns: PdfColumn<T>[],
	opts: ExportOptions,
): void {
	const doc = new jsPDF({ orientation: 'landscape' });

	doc.setFontSize(16);
	doc.text(opts.title, 14, 16);
	if (opts.subtitle) {
		doc.setFontSize(10);
		doc.setTextColor(100);
		doc.text(opts.subtitle, 14, 22);
		doc.setTextColor(0);
	}

	autoTable(doc, {
		startY: opts.subtitle ? 26 : 22,
		head: [columns.map((c) => c.header)],
		body: rows.map((row) => columns.map((c) => String(c.accessor(row)))),
		styles: { fontSize: 8, cellPadding: 2 },
		headStyles: { fillColor: [37, 99, 235] },
	});

	doc.save(`${opts.fileName}.pdf`);
}
