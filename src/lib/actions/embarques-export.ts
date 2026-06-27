"use server";

/**
 * Exportación AUDITADA de la worklist Comex de procesos (PR-020 / CX-02).
 *
 * Mirror de `exportarAuditoria`: re-lee la MISMA vista+moneda de la URL vía
 * `listarEmbarques` (SÓLO lectura), serializa CSV/XLSX y registra un evento
 * EXPORTACION (meta-auditoría). Reproduce los filtros de SERVIDOR (vista/moneda);
 * la búsqueda rápida in-grid no se aplica (consistente con PR-010).
 *
 * Superficie de import DELIBERADAMENTE restringida a lectura+serialización+
 * auditoría: NUNCA importa `services/comex` / `asiento-automatico` / `stock` (el
 * motor G-09). Gate de costo: la columna Costo Total se incluye SÓLO con
 * `VER_COSTO_LANDED` (re-checado en el servidor; no se confía en el cliente).
 * ⚠️ No existe un permiso de EXPORTACIÓN dedicado para Comex en el catálogo
 * (a diferencia de `auditoria.exportar`) — la acción queda autenticada + auditada;
 * ver IMPLEMENTATION_NOTES_PR020.md (gap de permiso owed en follow-up).
 */

import { requireSessionUser } from "@/lib/auth-guard";
import { toCsv } from "@/lib/export/csv";
import type { ExportColumn } from "@/lib/export/types";
import { toXlsx } from "@/lib/export/xlsx";
import { hasPermission, PERMISOS } from "@/lib/permisos";
import { auditarExportacion } from "@/lib/services/auditar-exportacion";
import { parseVista } from "@/lib/services/comex-worklist-derivaciones";
import type { Moneda } from "@/generated/prisma/client";

import { type EmbarqueWorklistRow, listarEmbarques } from "./embarques";

type Formato = "csv" | "xlsx";

export type ExportarEmbarquesResult =
  | { ok: true; filename: string; mime: string; base64: string }
  | { ok: false; error: string };

const CSV_MIME = "text/csv;charset=utf-8";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function fmtFecha(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function parseMoneda(v: string | undefined): Moneda | undefined {
  if (v === "ARS") return "ARS";
  if (v === "USD") return "USD";
  return undefined;
}

/** Column set del archivo. La columna Costo se agrega SÓLO con permiso (gate). */
function buildEmbarquesExportColumns(verCosto: boolean): ExportColumn<EmbarqueWorklistRow>[] {
  const base: ExportColumn<EmbarqueWorklistRow>[] = [
    { header: "Proceso", value: (r) => r.codigo },
    { header: "Proveedor", value: (r) => r.proveedor.nombre },
    { header: "País", value: (r) => r.proveedor.pais },
    { header: "Status", value: (r) => r.estado },
    { header: "ETA", value: (r) => fmtFecha(r.fechaLlegada) },
    { header: "FOB/CFR (USD)", value: (r) => r.fobUsd },
    { header: "Moneda", value: (r) => r.moneda },
    { header: "Containers", value: (r) => r.contenedores.length },
    { header: "Cant. neumáticos", value: (r) => r.cantidadNeumaticos },
    { header: "Puerto", value: (r) => r.lugarIncoterm ?? "" },
    { header: "Status costo", value: (r) => r.statusCosto },
    { header: "Status pago", value: (r) => r.statusPago ?? "" },
    { header: "Bloqueo", value: (r) => r.bloqueo ?? "" },
    { header: "Última actualización", value: (r) => fmtFecha(r.updatedAt) },
  ];
  if (!verCosto) return base;
  return [...base, { header: "Costo Total (ARS)", value: (r) => r.costoTotal ?? "" }];
}

function selloFecha(): string {
  return new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
}

async function serializarExport(
  formato: Formato,
  columnas: ExportColumn<EmbarqueWorklistRow>[],
  rows: EmbarqueWorklistRow[],
): Promise<{ base64: string; mime: string; filename: string }> {
  const sello = selloFecha();
  if (formato === "xlsx") {
    const bytes = await toXlsx(columnas, rows, "Procesos Comex");
    return {
      base64: Buffer.from(bytes).toString("base64"),
      mime: XLSX_MIME,
      filename: `comex-procesos-${sello}.xlsx`,
    };
  }
  const csv = toCsv(columnas, rows);
  return {
    base64: Buffer.from(csv, "utf8").toString("base64"),
    mime: CSV_MIME,
    filename: `comex-procesos-${sello}.csv`,
  };
}

export async function exportarEmbarques(input: {
  params: { vista?: string; moneda?: string };
  formato: Formato;
}): Promise<ExportarEmbarquesResult> {
  // Autenticado (FK-safe para el evento de auditoría). Sin permiso de export comex
  // dedicado en el catálogo → el costo se gatea por columna (VER_COSTO_LANDED).
  await requireSessionUser();
  const verCosto = await hasPermission(PERMISOS.VER_COSTO_LANDED);

  const vista = parseVista(input.params.vista);
  const moneda = parseMoneda(input.params.moneda);
  const { rows } = await listarEmbarques({ vista, moneda, verCosto });

  const columnas = buildEmbarquesExportColumns(verCosto);
  const { base64, mime, filename } = await serializarExport(input.formato, columnas, rows);

  // Meta-auditoría: si falla, propaga → no se entrega el archivo sin registrar.
  await auditarExportacion({
    recurso: "comex-procesos",
    filtros: { vista, moneda: moneda ?? null, verCosto },
    columnas: columnas.map((c) => c.header),
    nFilas: rows.length,
    formato: input.formato,
  });

  return { ok: true, filename, mime, base64 };
}
