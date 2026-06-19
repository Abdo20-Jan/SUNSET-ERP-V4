import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { toXlsx } from "@/lib/export/xlsx";
import type { ExportColumn } from "@/lib/export/types";

type Row = { nombre: string; stock: number; nota: string | null };

const cols: ExportColumn<Row>[] = [
  { header: "Nombre", value: (r) => r.nombre },
  { header: "Stock", value: (r) => r.stock },
  { header: "Nota", value: (r) => r.nota ?? "" },
];

// Escribe el buffer a un temp file y lo relee con exceljs (mismo patrón que
// export-bp-excel.test.ts: evita el mismatch de tipos Buffer<ArrayBuffer>).
async function leer(bytes: Uint8Array): Promise<ExcelJS.Worksheet> {
  const dir = mkdtempSync(join(tmpdir(), "export-xlsx-"));
  const file = join(dir, "out.xlsx");
  writeFileSync(file, bytes);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return wb.worksheets[0];
}

describe("toXlsx", () => {
  it("escribe la hoja con el nombre dado y el header en negrita", async () => {
    const buf = await toXlsx(cols, [{ nombre: "Cubierta", stock: 12, nota: null }], "Productos");
    const ws = await leer(buf);

    expect(ws.name).toBe("Productos");
    const head = ws.getRow(1);
    expect([head.getCell(1).value, head.getCell(2).value, head.getCell(3).value]).toEqual([
      "Nombre",
      "Stock",
      "Nota",
    ]);
    expect(head.getCell(1).font?.bold).toBe(true);
  });

  it("escribe números como celda numérica y null como vacío", async () => {
    const buf = await toXlsx(cols, [{ nombre: "Cubierta", stock: 12, nota: null }], "Productos");
    const ws = await leer(buf);

    const row = ws.getRow(2);
    expect(row.getCell(1).value).toBe("Cubierta");
    expect(row.getCell(2).value).toBe(12);
    // null → "" → exceljs lo guarda como celda vacía (value nullish o cadena vacía).
    expect(row.getCell(3).value ?? "").toBe("");
  });

  it("sin filas → solo la fila de header", async () => {
    const buf = await toXlsx(cols, [], "Productos");
    const ws = await leer(buf);
    expect(ws.rowCount).toBe(1);
  });
});
