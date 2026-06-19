import ExcelJS from "exceljs";

import type { ExportColumn } from "@/lib/export/types";

// Serializa filas a un workbook XLSX (una hoja). La fila 1 son los headers en
// negrita; cada celda toma `column.value(row)` (null → ""). SOLO server:
// `exceljs` no debe importarse en un client component.
export async function toXlsx<T>(
  columns: ExportColumn<T>[],
  rows: T[],
  sheetName: string,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(columns.map((c) => c.header));
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    ws.addRow(columns.map((c) => c.value(r) ?? ""));
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
