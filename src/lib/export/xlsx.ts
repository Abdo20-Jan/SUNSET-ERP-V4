import "server-only";

import ExcelJS from "exceljs";

import type { ExportColumn } from "@/lib/export/types";

// Genera un workbook XLSX (una hoja) a partir de columnas + filas. La fila 1 son
// los headers en negrita. Cada celda toma `column.value(row)`: los números van
// como celda numérica y el resto como texto (null → ""). SOLO server: `exceljs`
// no debe importarse en un client component. Reusa exceljs (ya en el repo por el
// export del Balance) → cero dependencia nueva.
export async function toXlsx<T>(
  columns: ExportColumn<T>[],
  rows: T[],
  sheetName: string,
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Sunset ERP";
  const ws = wb.addWorksheet(sheetName);

  const header = ws.addRow(columns.map((c) => c.header));
  header.font = { bold: true };

  for (const row of rows) {
    ws.addRow(columns.map((c) => c.value(row) ?? ""));
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf);
}
