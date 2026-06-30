"use server";

/**
 * Exportación AUDITADA del briefing diario del Cockpit Operacional Comex
 * (CX-01 §9-funcional 9 · PR-022d).
 *
 * Mirror de `exportarEmbarques`: re-lee el cockpit server-side con los MISMOS
 * filtros de la URL (vista/proveedor/ETA/estado · PR-022b) vía `getCockpitData`
 * (SÓLO lectura), aplana el briefing (`construirBriefing`), serializa CSV/XLSX y
 * registra un evento EXPORTACION (meta-auditoría). Reproduce los filtros de
 * SERVIDOR; la búsqueda rápida en pantalla NO se aplica.
 *
 * Superficie de import DELIBERADAMENTE restringida a lectura+serialización+
 * auditoría: NUNCA importa `services/comex` / `despacho-parcial` / `asiento` /
 * `stock` (el motor G-09). El costo NUNCA se recalcula: `getCockpitData` ya
 * enmascara TODO valor financiero server-side cuando falta `VER_COSTO_LANDED`
 * (CRIT-10). Gate de export: clave dedicada `COMEX_COCKPIT_EXPORTAR`. La ÚNICA
 * escritura es el append del evento EXPORTACION (vía `auditarExportacion`); si la
 * auditoría falla, propaga → NO se entrega el archivo.
 */

import { toCsv } from "@/lib/export/csv";
import { toXlsx } from "@/lib/export/xlsx";
import { hasPermission, PERMISOS, requirePermission } from "@/lib/permisos";
import { auditarExportacion } from "@/lib/services/auditar-exportacion";
import { getCockpitData } from "@/lib/services/comex-cockpit";
import {
  BRIEFING_COLUMNS,
  type BriefingRow,
  construirBriefing,
} from "@/lib/services/comex-cockpit-briefing";
import {
  type CockpitSearchParams,
  parseCockpitFiltros,
} from "@/lib/services/comex-cockpit-filtros";

type Formato = "csv" | "xlsx";

export type ExportarCockpitDiaResult =
  | { ok: true; filename: string; mime: string; base64: string }
  | { ok: false; error: string };

const CSV_MIME = "text/csv;charset=utf-8";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function parseMonedaSnapshot(v: string | undefined): "ARS" | "USD" {
  return v === "ARS" ? "ARS" : "USD";
}

function selloFecha(): string {
  return new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
}

async function serializar(
  formato: Formato,
  rows: BriefingRow[],
): Promise<{ base64: string; mime: string; filename: string }> {
  const sello = selloFecha();
  if (formato === "xlsx") {
    const bytes = await toXlsx(BRIEFING_COLUMNS, rows, "Briefing Comex");
    return {
      base64: Buffer.from(bytes).toString("base64"),
      mime: XLSX_MIME,
      filename: `comex-cockpit-dia-${sello}.xlsx`,
    };
  }
  const csv = toCsv(BRIEFING_COLUMNS, rows);
  return {
    base64: Buffer.from(csv, "utf8").toString("base64"),
    mime: CSV_MIME,
    filename: `comex-cockpit-dia-${sello}.csv`,
  };
}

export async function exportarCockpitDia(input: {
  params: CockpitSearchParams & { moneda?: string };
  formato: Formato;
}): Promise<ExportarCockpitDiaResult> {
  // Gate de export (PR-022d): clave dedicada `comex.cockpit.exportar` (dimensión
  // EXPORTACION). Niega en el servidor (defensa real); el botón también se oculta
  // en la UI cuando falta el permiso.
  const gate = await requirePermission(PERMISOS.COMEX_COCKPIT_EXPORTAR);
  if (!gate.ok) return { ok: false, error: gate.error };

  // Gate de costo re-checado server-side (CRIT-10): gobierna el strip de TODO
  // valor financiero dentro de `getCockpitData`; el costo NUNCA viaja sin permiso.
  const verCosto = await hasPermission(PERMISOS.VER_COSTO_LANDED);

  // Re-lectura con los MISMOS filtros de la URL → reproduce la vista de SERVIDOR.
  const now = new Date();
  const { vista, filtros } = parseCockpitFiltros(input.params, now);
  const moneda = parseMonedaSnapshot(input.params.moneda);

  const data = await getCockpitData({ now, verCosto, filtros });
  const rows = construirBriefing(data);

  const { base64, mime, filename } = await serializar(input.formato, rows);

  // Meta-auditoría (AUD-01): si falla, propaga → NO se entrega el archivo sin registrar.
  await auditarExportacion({
    recurso: "comex-cockpit",
    filtros: {
      vista,
      proveedorId: filtros.proveedorId ?? null,
      estado: filtros.estado ?? null,
      etaDesde: filtros.etaDesde?.toISOString() ?? null,
      etaHasta: filtros.etaHasta?.toISOString() ?? null,
      foco: filtros.foco ?? null,
      moneda,
      verCosto,
    },
    columnas: BRIEFING_COLUMNS.map((c) => c.header),
    nFilas: rows.length,
    formato: input.formato,
  });

  return { ok: true, filename, mime, base64 };
}
