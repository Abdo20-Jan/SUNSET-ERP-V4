"use server";

/**
 * Exportación AUDITADA de la worklist de inventario (INV-01 · PR-027).
 * Espejo de `fin-cxc-export.ts` (PR-026): re-lee la MISMA vista de la URL vía
 * la proyección `listarInventarioWorklist` (SÓLO lectura — motor de stock
 * jamás invocado) con los MISMOS presets server-side
 * (`resolverVista`/`resolverDias`/`filtrarPorVista`/`ordenarPorDeposito`),
 * serializa CSV/XLSX y registra un evento EXPORTACION (meta-auditoría; si
 * falla, propaga — no se entrega el archivo sin registrar). La búsqueda
 * rápida y los chips in-grid no se aplican (client-only, igual que la serie).
 *
 * Gate de datos: la página no tiene permiso de acceso propio (cantidades y
 * alertas visibles a toda sesión — espejo de la matriz actual), así que la
 * acción exige sesión (FK-safe para el evento) y re-chequea SOLO
 * `VER_COSTO_STOCK` server-side: sin la clave, la columna "Costo promedio"
 * NO EXISTE en el archivo (consume-or-omit — jamás "—") y la proyección ni
 * ejecuta la query de costos. Cero claves nuevas (restricción PR-027).
 */

import { requireSessionUser } from "@/lib/auth-guard";
import { toCsv } from "@/lib/export/csv";
import type { ExportColumn } from "@/lib/export/types";
import { toXlsx } from "@/lib/export/xlsx";
import { puedeVerCostoStock } from "@/lib/permisos-masking";
import { auditarExportacion } from "@/lib/services/auditar-exportacion";
import {
  ALERTA_LABEL,
  filtrarPorVista,
  type InventarioWorklistRow,
  listarInventarioWorklist,
  ordenarPorDeposito,
  resolverDias,
  resolverVista,
} from "@/lib/services/inventario-worklist";

type Formato = "csv" | "xlsx";

export type ExportarInventarioResult =
  | { ok: true; filename: string; mime: string; base64: string }
  | { ok: false; error: string };

const CSV_MIME = "text/csv;charset=utf-8";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Fecha ISO → YYYY-MM-DD para el archivo ("" en filas pipeline). */
function isoDia(fecha: string | null): string {
  return fecha === null ? "" : fecha.slice(0, 10);
}

function buildColumnas(verCosto: boolean): ExportColumn<InventarioWorklistRow>[] {
  const base: ExportColumn<InventarioWorklistRow>[] = [
    { header: "SKU", value: (r) => r.codigo },
    { header: "Producto", value: (r) => r.nombre },
    { header: "Medida", value: (r) => r.medida ?? "" },
    { header: "Marca", value: (r) => r.marca ?? "" },
    { header: "Depósito", value: (r) => r.depositoNombre },
    { header: "Fiscal", value: (r) => (r.depositoFiscal ? "Sí" : "") },
    { header: "Físico", value: (r) => r.fisico },
    { header: "Disponible", value: (r) => r.disponible },
    { header: "Reservado", value: (r) => r.reservado },
    { header: "En fiscal (producto)", value: (r) => r.enFiscal },
    { header: "Futuro Comex (≤90d)", value: (r) => r.futuroComex.total },
    { header: "En producción (≤90d)", value: (r) => r.futuroComex.enProduccion },
    { header: "En tránsito (≤90d)", value: (r) => r.futuroComex.enTransito },
    // Totales SIN corte — la vista [En tránsito] filtra por este contador
    // (semántica de las tabs viejas); el archivo debe poder explicarla.
    { header: "En tránsito (total)", value: (r) => r.futuroComex.enTransitoTotal },
    { header: "En producción (total)", value: (r) => r.futuroComex.enProduccionTotal },
    { header: "Despachos activos", value: (r) => r.despachosActivos },
    { header: "Último movimiento", value: (r) => isoDia(r.ultimoMovimiento) },
    { header: "Alerta", value: (r) => (r.alerta ? ALERTA_LABEL[r.alerta] : "") },
  ];
  // Consume-or-omit: sin `VER_COSTO_STOCK` la columna NO ENTRA al archivo
  // (espejo `return verCosto ? [...base, costo] : base` de PR-024/025).
  if (!verCosto) return base;
  return [...base, { header: "Costo promedio", value: (r) => r.costoPromedio ?? "" }];
}

function selloFecha(): string {
  return new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
}

async function serializarExport(
  formato: Formato,
  columnas: ExportColumn<InventarioWorklistRow>[],
  rows: InventarioWorklistRow[],
): Promise<{ base64: string; mime: string; filename: string }> {
  const sello = selloFecha();
  if (formato === "xlsx") {
    const bytes = await toXlsx(columnas, rows, "Inventario");
    return {
      base64: Buffer.from(bytes).toString("base64"),
      mime: XLSX_MIME,
      filename: `inventario-stock-general-${sello}.xlsx`,
    };
  }
  const csv = toCsv(columnas, rows);
  return {
    base64: Buffer.from(csv, "utf8").toString("base64"),
    mime: CSV_MIME,
    filename: `inventario-stock-general-${sello}.csv`,
  };
}

export async function exportarInventarioWorklist(input: {
  params: { vista?: string; agrupar?: string; dias?: string };
  formato: Formato;
}): Promise<ExportarInventarioResult> {
  // Autenticado (FK-safe para el evento de auditoría) + re-check del gate de
  // costo server-side (nunca se confía en el cliente).
  await requireSessionUser();
  const verCosto = await puedeVerCostoStock();

  const { rows } = await listarInventarioWorklist(verCosto);

  // Mismos presets (`?vista=`/`?dias=`/`?agrupar=`) que la page — server-side.
  const vista = resolverVista(input.params.vista);
  const dias = resolverDias(input.params.dias);
  const base = input.params.agrupar === "deposito" ? ordenarPorDeposito(rows) : rows;
  const filas = filtrarPorVista(base, vista, dias);

  const columnas = buildColumnas(verCosto);
  const { base64, mime, filename } = await serializarExport(input.formato, columnas, filas);

  // Meta-auditoría: si falla, propaga → no se entrega el archivo sin registrar.
  await auditarExportacion({
    recurso: "inventario",
    filtros: { vista, dias, agrupar: input.params.agrupar === "deposito" },
    columnas: columnas.map((c) => c.header),
    nFilas: filas.length,
    formato: input.formato,
  });

  return { ok: true, filename, mime, base64 };
}
