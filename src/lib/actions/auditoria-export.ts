"use server";

import { PERMISOS, requirePermission } from "@/lib/permisos";
import { toCsv } from "@/lib/export/csv";
import type { ExportColumn } from "@/lib/export/types";
import { toXlsx } from "@/lib/export/xlsx";
import { auditarExportacion } from "@/lib/services/auditar-exportacion";
import { type AuditoriaSearchParams, parseFiltros } from "@/lib/services/auditoria-filtros";
import { type AuditoriaRow, CAP_EXPORT, listarAuditoria } from "@/lib/services/auditoria-query";

// Exportación AUDITADA de la worklist de auditoría (AUD-01). Gateada en el
// BACKEND por `auditoria.exportar` (no sólo UI). Registra un evento EXPORTACION
// (meta-auditoría) vía `auditarExportacion`. Devuelve el archivo en base64
// (CSV/XLSX) — base64 evita corromper el binario del XLSX al cruzar el límite
// de la server action. NO toca el registry/route genérico de export.

type Formato = "csv" | "xlsx";

export type ExportarAuditoriaResult =
  | { ok: true; filename: string; mime: string; base64: string }
  | { ok: false; error: string };

const CSV_MIME = "text/csv;charset=utf-8";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Columnas planas del export (una fila por evento; el diff NO se aplana). */
function buildAuditoriaExportColumns(): ExportColumn<AuditoriaRow>[] {
  return [
    { header: "Fecha", value: (r) => r.fechaLabel },
    { header: "Hora", value: (r) => r.horaLabel },
    { header: "Usuario", value: (r) => r.usuarioNombre },
    { header: "Acción", value: (r) => r.accionLabel },
    { header: "Origen", value: (r) => r.origenLabel },
    { header: "Tabla", value: (r) => r.tablaLabel },
    { header: "Registro", value: (r) => r.registroId },
    { header: "Motivo", value: (r) => r.motivo ?? "" },
    { header: "IP", value: (r) => r.ip ?? "" },
  ];
}

function selloFecha(): string {
  return new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
}

async function serializarExport(
  formato: Formato,
  columnas: ExportColumn<AuditoriaRow>[],
  rows: AuditoriaRow[],
): Promise<{ base64: string; mime: string; filename: string }> {
  const sello = selloFecha();
  if (formato === "xlsx") {
    const bytes = await toXlsx(columnas, rows, "Auditoría");
    return {
      base64: Buffer.from(bytes).toString("base64"),
      mime: XLSX_MIME,
      filename: `auditoria-${sello}.xlsx`,
    };
  }
  const csv = toCsv(columnas, rows);
  return {
    base64: Buffer.from(csv, "utf8").toString("base64"),
    mime: CSV_MIME,
    filename: `auditoria-${sello}.csv`,
  };
}

export async function exportarAuditoria(input: {
  params: AuditoriaSearchParams;
  formato: Formato;
}): Promise<ExportarAuditoriaResult> {
  const guard = await requirePermission(PERMISOS.AUDITORIA_EXPORTAR);
  if (!guard.ok) return { ok: false, error: guard.error };

  const filtros = parseFiltros(input.params);
  const rows = await listarAuditoria(filtros, { cap: CAP_EXPORT });
  const columnas = buildAuditoriaExportColumns();
  const { base64, mime, filename } = await serializarExport(input.formato, columnas, rows);

  // Meta-auditoría: si falla, propaga → no se entrega el archivo sin registrar.
  await auditarExportacion({
    recurso: "auditoria",
    filtros: input.params,
    columnas: columnas.map((c) => c.header),
    nFilas: rows.length,
    formato: input.formato,
  });

  return { ok: true, filename, mime, base64 };
}
