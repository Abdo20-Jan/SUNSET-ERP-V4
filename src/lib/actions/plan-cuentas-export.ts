"use server";

/**
 * Exportación AUDITADA del Plan de Cuentas (CONT-02 · PR-028, Q&A estructural
 * 8 — [Exportar Excel]). Mirror estructural de `fin-cxc-export.ts`: re-lee
 * server-side la MISMA proyección de la page (`getPlanDeCuentasConSaldo` —
 * saldo del balance reusado, jamás re-derivado), serializa CSV/XLSX con las
 * columnas canónicas y registra el evento EXPORTACION ANTES de entregar (si
 * la meta-auditoría falla, propaga). Sin clave de permiso propia (semántica
 * actual de la página = sesión autenticada; decisión del dueño en el plan) —
 * `requireSessionUser()` además es FK-safe para el evento.
 */

import { requireSessionUser } from "@/lib/auth-guard";
import { toCsv } from "@/lib/export/csv";
import type { ExportColumn } from "@/lib/export/types";
import { toXlsx } from "@/lib/export/xlsx";
import { auditarExportacion } from "@/lib/services/auditar-exportacion";
import { type CuentaArbolRow, getPlanDeCuentasConSaldo } from "@/lib/services/plan-cuentas-arbol";

type Formato = "csv" | "xlsx";

export type ExportarPlanDeCuentasResult =
  | { ok: true; filename: string; mime: string; base64: string }
  | { ok: false; error: string };

const CSV_MIME = "text/csv;charset=utf-8";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function estadoLabel(row: CuentaArbolRow): string {
  if (row.activa) return "ACTIVA";
  return "INACTIVA";
}

/** Las 7 columnas canónicas + Nivel/Padre (estructura del árbol). */
function buildColumnas(): ExportColumn<CuentaArbolRow>[] {
  return [
    { header: "Código", value: (r) => r.codigo },
    { header: "Nombre", value: (r) => r.nombre },
    { header: "Tipo", value: (r) => r.categoria },
    { header: "Naturaleza", value: (r) => r.naturaleza },
    { header: "Categoría", value: (r) => r.tipo },
    { header: "Nivel", value: (r) => r.nivel },
    { header: "Padre", value: (r) => r.padreCodigo ?? "" },
    { header: "Estado", value: (r) => estadoLabel(r) },
    { header: "Saldo", value: (r) => r.saldo },
  ];
}

function selloFecha(): string {
  return new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
}

async function serializarExport(
  formato: Formato,
  columnas: ExportColumn<CuentaArbolRow>[],
  rows: CuentaArbolRow[],
): Promise<{ base64: string; mime: string; filename: string }> {
  const sello = selloFecha();
  if (formato === "xlsx") {
    const bytes = await toXlsx(columnas, rows, "Plan de cuentas");
    return {
      base64: Buffer.from(bytes).toString("base64"),
      mime: XLSX_MIME,
      filename: `contabilidad-plan-de-cuentas-${sello}.xlsx`,
    };
  }
  const csv = toCsv(columnas, rows);
  return {
    base64: Buffer.from(csv, "utf8").toString("base64"),
    mime: CSV_MIME,
    filename: `contabilidad-plan-de-cuentas-${sello}.csv`,
  };
}

export async function exportarPlanDeCuentas(input: {
  formato: Formato;
}): Promise<ExportarPlanDeCuentasResult> {
  await requireSessionUser();

  // Re-lectura server-side de la MISMA proyección de la page.
  const { flat, fechaCorte } = await getPlanDeCuentasConSaldo();

  const columnas = buildColumnas();
  const { base64, mime, filename } = await serializarExport(input.formato, columnas, flat);

  // Meta-auditoría: si falla, propaga → no se entrega el archivo sin registrar.
  await auditarExportacion({
    recurso: "contabilidad-plan-de-cuentas",
    filtros: { fechaCorte },
    columnas: columnas.map((c) => c.header),
    nFilas: flat.length,
    formato: input.formato,
  });

  return { ok: true, filename, mime, base64 };
}
