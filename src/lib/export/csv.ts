import type { ExportColumn } from "@/lib/export/types";

// Escapa un valor para CSV (RFC 4180): null → ""; si contiene coma, comilla o
// salto de línea, se envuelve en comillas dobles y se duplican las comillas
// internas.
function esc(v: string | number | null): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Serializa filas a CSV puro. Antepone un BOM (﻿) para que Excel detecte
// UTF-8. Sin filas → solo la línea de cabecera (con BOM). PURO: sin I/O.
export function toCsv<T>(columns: ExportColumn<T>[], rows: T[]): string {
  const head = columns.map((c) => esc(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => esc(c.value(r))).join(",")).join("\r\n");
  return `﻿${head}${rows.length ? `\r\n${body}` : ""}`;
}
