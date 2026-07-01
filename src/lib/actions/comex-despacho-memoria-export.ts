"use server";

/**
 * PR-023c (CX-06) — Export AUDITADO (CSV/XLSX) de la memoria de cálculo del
 * despacho. Mirror de `exportarEmbarques`: gatea, re-lee/proyecta server-side,
 * serializa y registra un evento EXPORTACION (meta-auditoría) ANTES de devolver
 * el archivo — si la auditoría falla, propaga y NO se entrega base64.
 *
 * A diferencia de `exportarEmbarques` (que sólo gatea la COLUMNA de costo), la
 * memoria es ÍNTEGRAMENTE sensible (FOB/rateio/capitalizables) → sin
 * `VER_COSTO_LANDED` se NIEGA la acción entera (nada se lee/proyecta/serializa).
 *
 * Superficie de import restringida a lectura+serialización+auditoría: NUNCA
 * importa el motor (`services/comex`/`despacho-parcial`)/asiento/stock. Sin PDF
 * (no hay infra). Sin permiso de export nuevo (usa sólo `VER_COSTO_LANDED`).
 */

import { requireSessionUser } from "@/lib/auth-guard";
import { toCsv } from "@/lib/export/csv";
import type { ExportColumn } from "@/lib/export/types";
import { toXlsx } from "@/lib/export/xlsx";
import { hasPermission, PERMISOS } from "@/lib/permisos";
import { auditarExportacion } from "@/lib/services/auditar-exportacion";
import {
  buildMemoriaRows,
  leerMemoriaDetalle,
  type MemoriaRow,
  memoriaExportColumns,
} from "@/lib/services/despacho-memoria-vista";

type Formato = "csv" | "xlsx";

export type ExportarMemoriaResult =
  | { ok: true; filename: string; mime: string; base64: string }
  | { ok: false; error: string };

const CSV_MIME = "text/csv;charset=utf-8";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function selloFecha(): string {
  return new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
}

async function serializar(
  formato: Formato,
  columnas: ExportColumn<MemoriaRow>[],
  rows: MemoriaRow[],
  codigo: string,
): Promise<{ base64: string; mime: string; filename: string }> {
  const sello = selloFecha();
  const slug = codigo.replace(/[^\w.-]+/g, "_");
  if (formato === "xlsx") {
    const bytes = await toXlsx(columnas, rows, "Memoria de costo");
    return {
      base64: Buffer.from(bytes).toString("base64"),
      mime: XLSX_MIME,
      filename: `memoria-despacho-${slug}-${sello}.xlsx`,
    };
  }
  const csv = toCsv(columnas, rows);
  return {
    base64: Buffer.from(csv, "utf8").toString("base64"),
    mime: CSV_MIME,
    filename: `memoria-despacho-${slug}-${sello}.csv`,
  };
}

export async function exportarMemoriaDespacho(input: {
  despachoId: string;
  formato: Formato;
}): Promise<ExportarMemoriaResult> {
  // Autenticado (FK-safe para el evento de auditoría).
  await requireSessionUser();

  // Gate ÚNICO `VER_COSTO_LANDED`: sin permiso NO se lee/proyecta/serializa nada.
  if (!(await hasPermission(PERMISOS.VER_COSTO_LANDED))) {
    return { ok: false, error: "No tenés permiso para exportar la memoria de costo landed." };
  }

  const leida = await leerMemoriaDetalle(input.despachoId);
  if (!leida.ok) {
    return {
      ok: false,
      error:
        leida.reason === "COSTOS_ABIERTOS"
          ? "Cerrá los costos del contenedor antes de exportar la memoria."
          : "El despacho no tiene memoria de rateio.",
    };
  }
  if (leida.detalle.tipo === "LEGACY") {
    return { ok: false, error: "Despacho legacy — sin memoria de rateio para exportar." };
  }

  const detalle = leida.detalle;
  const columnas = memoriaExportColumns();
  const rows = buildMemoriaRows(detalle);
  const { base64, mime, filename } = await serializar(
    input.formato,
    columnas,
    rows,
    detalle.codigo,
  );

  // Meta-auditoría: si falla, propaga → NO se entrega el archivo sin registrar.
  await auditarExportacion({
    recurso: "comex-despacho-memoria",
    filtros: {
      despachoId: input.despachoId,
      embarqueId: detalle.embarqueId,
      codigo: detalle.codigo,
      baseRateio: detalle.baseRateio,
      verCosto: true,
    },
    columnas: columnas.map((c) => c.header),
    nFilas: rows.length,
    formato: input.formato,
  });

  return { ok: true, base64, mime, filename };
}
