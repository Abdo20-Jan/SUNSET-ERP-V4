"use server";

/**
 * Exportación AUDITADA de la worklist de asientos (CONT-01 · PR-028). Mirror
 * estructural de `fin-cxc-export.ts` (PR-026): re-lee server-side la MISMA
 * proyección (`listarAsientosWorklist`) con los MISMOS presets de la URL
 * (`?vista=`/`?periodo=`/`?cuentaId=`/`?desde=`/`?hasta=`), serializa CSV/XLSX
 * con las 9 columnas OD-07 y registra un evento EXPORTACION ANTES de entregar
 * (si la meta-auditoría falla, propaga — no se entrega archivo sin registrar).
 *
 * Gate: la página de asientos no tiene clave de permiso propia (semántica
 * actual = sesión autenticada; decisión del dueño en el plan PR-028 — no se
 * inventan claves). `requireSessionUser()` además es FK-safe para el evento.
 *
 * El archivo espeja el fetch del grid: mismo cap `ASIENTOS_WORKLIST_MAX` —
 * la búsqueda rápida y los chips client del grid NO se aplican (nota canon).
 * Superficie de import restringida a lectura + presentación + serialización +
 * auditoría: jamás importa `asiento-automatico` ni las actions de asientos.
 */

import { resolverAsientosVista } from "@/app/(dashboard)/contabilidad/asientos/asientos-presentacion";
import { requireSessionUser } from "@/lib/auth-guard";
import { toCsv } from "@/lib/export/csv";
import type { ExportColumn } from "@/lib/export/types";
import { toXlsx } from "@/lib/export/xlsx";
import { auditarExportacion } from "@/lib/services/auditar-exportacion";
import {
  type AsientosWorklistFiltros,
  type AsientoWorklistRow,
  listarAsientosWorklist,
  periodoDefaultId,
} from "@/lib/services/asientos-worklist";

type Formato = "csv" | "xlsx";

export type ExportarAsientosResult =
  | { ok: true; filename: string; mime: string; base64: string }
  | { ok: false; error: string };

const CSV_MIME = "text/csv;charset=utf-8";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseIdParam(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseDateParam(value: string | undefined): Date | undefined {
  if (!value || !DATE_RE.test(value)) return undefined;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseEndOfDayParam(value: string | undefined): Date | undefined {
  if (!value || !DATE_RE.test(value)) return undefined;
  const d = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Las 9 columnas OD-07: Número·Fecha·Período·Origen·Descripción·Debe·Haber·Estado·Documento. */
function buildColumnas(): ExportColumn<AsientoWorklistRow>[] {
  return [
    { header: "Número", value: (r) => r.numero },
    { header: "Fecha", value: (r) => r.fecha.slice(0, 10) },
    { header: "Período", value: (r) => r.periodoCodigo },
    { header: "Origen", value: (r) => r.origen },
    { header: "Descripción", value: (r) => r.descripcion },
    { header: "Debe", value: (r) => r.totalDebe },
    { header: "Haber", value: (r) => r.totalHaber },
    { header: "Estado", value: (r) => r.estado },
    { header: "Documento origen", value: (r) => r.doc?.etiqueta ?? "" },
  ];
}

function selloFecha(): string {
  return new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
}

async function serializarExport(
  formato: Formato,
  columnas: ExportColumn<AsientoWorklistRow>[],
  rows: AsientoWorklistRow[],
): Promise<{ base64: string; mime: string; filename: string }> {
  const sello = selloFecha();
  if (formato === "xlsx") {
    const bytes = await toXlsx(columnas, rows, "Asientos");
    return {
      base64: Buffer.from(bytes).toString("base64"),
      mime: XLSX_MIME,
      filename: `contabilidad-asientos-${sello}.xlsx`,
    };
  }
  const csv = toCsv(columnas, rows);
  return {
    base64: Buffer.from(csv, "utf8").toString("base64"),
    mime: CSV_MIME,
    filename: `contabilidad-asientos-${sello}.csv`,
  };
}

type ExportParams = {
  vista?: string;
  periodo?: string;
  cuentaId?: string;
  desde?: string;
  hasta?: string;
};

/**
 * MISMOS helpers de resolución que la page — el archivo espeja el grid.
 * URL sin `?periodo=` (estado default de la page) ⇒ el export resuelve el
 * MISMO período default server-side (`periodoDefaultId`); `?periodo=todos`
 * explícito ⇒ sin filtro de período.
 */
async function resolverFiltrosExport(params: ExportParams): Promise<AsientosWorklistFiltros> {
  return {
    vista: resolverAsientosVista(params.vista),
    periodoId: await resolverPeriodoExport(params.periodo),
    cuentaId: parseIdParam(params.cuentaId),
    fechaDesde: parseDateParam(params.desde),
    fechaHasta: parseEndOfDayParam(params.hasta),
  };
}

async function resolverPeriodoExport(periodo: string | undefined): Promise<number | undefined> {
  if (periodo === "todos") return undefined;
  const explicito = parseIdParam(periodo);
  if (explicito !== undefined) return explicito;
  return periodoDefaultId(new Date());
}

function oNull<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

/** Filtros efectivos que quedan registrados en el evento EXPORTACION. */
function filtrosAuditados(params: ExportParams, filtros: AsientosWorklistFiltros) {
  return {
    vista: filtros.vista,
    periodoId: oNull(filtros.periodoId),
    cuentaId: oNull(filtros.cuentaId),
    desde: oNull(params.desde),
    hasta: oNull(params.hasta),
  };
}

export async function exportarAsientos(input: {
  params: ExportParams;
  formato: Formato;
}): Promise<ExportarAsientosResult> {
  // Autenticado (FK-safe para el evento de auditoría). Sin clave propia:
  // sigue la semántica actual de la página (ver docblock).
  await requireSessionUser();

  const filtros = await resolverFiltrosExport(input.params);
  const { rows } = await listarAsientosWorklist(filtros);

  const columnas = buildColumnas();
  const { base64, mime, filename } = await serializarExport(input.formato, columnas, rows);

  // Meta-auditoría: si falla, propaga → no se entrega el archivo sin registrar.
  await auditarExportacion({
    recurso: "contabilidad-asientos",
    filtros: filtrosAuditados(input.params, filtros),
    columnas: columnas.map((c) => c.header),
    nFilas: rows.length,
    formato: input.formato,
  });

  return { ok: true, filename, mime, base64 };
}
