"use server";

/**
 * Exportación AUDITADA de la worklist de oportunidades (CRM-01 · PR-030).
 * Mirror de `fin-cxc-export.ts` / `compras-pedidos-export.ts`: re-lee
 * server-side con los MISMOS presets de la URL (`estado`/`filtro`/`owner`)
 * vía `listarOportunidades` + `listarProximasAccionesPendientes`, arma las
 * filas con los MISMOS helpers puros de la page (`armarWorklistRows` +
 * `resolverFiltro`/`filtrarSinAccion` — jamás se re-deriva nada), serializa
 * CSV/XLSX y registra un evento EXPORTACION ANTES de entregar
 * (meta-auditoría; si falla, no se entrega el archivo).
 *
 * Los facets client del grid (Stage/Owner/Moneda) y la búsqueda rápida NO se
 * aplican acá: son presentación in-memory — el archivo refleja los presets de
 * URL (paridad fin-cxc). Montos native-first: nativo intacto + columna de
 * presentación convertida por fila (`convertirMonto` dentro de
 * `proyectarFilaOportunidad`).
 *
 * Gate: el CRM entero va por `requireCrmAuth()` (flag + sesión FK-safe) — no
 * existe chave de permiso CRM y no se inventa.
 */

import {
  armarWorklistRows,
  buildColumnasExportOportunidades,
  derivarProximaAccionPorOportunidad,
  type FilaExportOportunidad,
  filtrarSinAccion,
  type OportunidadWorklistRow,
  parseEstadoParam,
  proyectarFilaOportunidad,
  resolverFiltro,
} from "@/app/(dashboard)/crm/oportunidades/_components/oportunidades-presentacion";
import { requireCrmAuth } from "@/lib/actions/_crm-helpers";
import { listarOportunidades } from "@/lib/actions/oportunidades";
import { auth } from "@/lib/auth";
import { toCsv } from "@/lib/export/csv";
import type { ExportColumn } from "@/lib/export/types";
import { toXlsx } from "@/lib/export/xlsx";
import { auditarExportacion } from "@/lib/services/auditar-exportacion";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { listarProximasAccionesPendientes } from "@/lib/services/crm-proxima-accion";

type Formato = "csv" | "xlsx";
type MonedaPres = "ARS" | "USD";

export type ExportarOportunidadesResult =
  | { ok: true; filename: string; mime: string; base64: string }
  | { ok: false; error: string };

const CSV_MIME = "text/csv;charset=utf-8";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Misma derivación de moneda de presentación que la page (URL > preferencia). */
async function resolverMoneda(param: string | undefined): Promise<MonedaPres> {
  if (param === "ARS" || param === "USD") return param;
  const session = await auth();
  return session?.user.monedaPreferida === "ARS" ? "ARS" : "USD";
}

/** `owner=me` = filtro de presentación por el usuario logueado (NO seguridad). */
function resolverOwnerId(owner: string | undefined, userId: string): string | undefined {
  if (owner === "me") return userId;
  return undefined;
}

function selloFecha(): string {
  return new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
}

async function serializarExport(
  formato: Formato,
  columnas: ExportColumn<FilaExportOportunidad>[],
  rows: FilaExportOportunidad[],
): Promise<{ base64: string; mime: string; filename: string }> {
  const sello = selloFecha();
  if (formato === "xlsx") {
    const bytes = await toXlsx(columnas, rows, "Oportunidades");
    return {
      base64: Buffer.from(bytes).toString("base64"),
      mime: XLSX_MIME,
      filename: `crm-oportunidades-${sello}.xlsx`,
    };
  }
  const csv = toCsv(columnas, rows);
  return {
    base64: Buffer.from(csv, "utf8").toString("base64"),
    mime: CSV_MIME,
    filename: `crm-oportunidades-${sello}.csv`,
  };
}

function aplicarFiltro(
  filas: OportunidadWorklistRow[],
  filtro: ReturnType<typeof resolverFiltro>,
): OportunidadWorklistRow[] {
  if (filtro === "sin_accion") return filtrarSinAccion(filas);
  return filas;
}

export async function exportarOportunidades(input: {
  params: { estado?: string; filtro?: string; owner?: string; moneda?: string };
  formato: Formato;
}): Promise<ExportarOportunidadesResult> {
  try {
    // Flag CRM + sesión FK-safe (para el evento de auditoría).
    const guard = await requireCrmAuth();
    if (!guard.ok) return { ok: false, error: guard.error };

    const [moneda, cotizacion] = await Promise.all([
      resolverMoneda(input.params.moneda),
      getCotizacionParaFecha(new Date()),
    ]);
    const tc = cotizacion ? cotizacion.valor.toString() : null;

    // MISMOS reads de la page (payload idéntico a la lista).
    const [ops, pendientes] = await Promise.all([
      listarOportunidades({
        estado: parseEstadoParam(input.params.estado),
        ownerId: resolverOwnerId(input.params.owner, guard.userId),
      }),
      listarProximasAccionesPendientes(),
    ]);

    // Mismos presets (`?filtro=`) que la page — server-side, helpers puros.
    const filtro = resolverFiltro(input.params.filtro);
    const filas = aplicarFiltro(
      armarWorklistRows(ops, derivarProximaAccionPorOportunidad(pendientes)),
      filtro,
    );

    const rows = filas.map((r) => proyectarFilaOportunidad(r, moneda, tc));
    const columnas = buildColumnasExportOportunidades(moneda);
    const { base64, mime, filename } = await serializarExport(input.formato, columnas, rows);

    // Meta-auditoría ANTES de retornar: si falla, no se entrega el archivo.
    await auditarExportacion({
      recurso: "crm-oportunidades",
      filtros: {
        estado: input.params.estado,
        filtro,
        owner: input.params.owner,
        moneda,
        tc,
      },
      columnas: columnas.map((c) => c.header),
      nFilas: rows.length,
      formato: input.formato,
    });

    return { ok: true, filename, mime, base64 };
  } catch (err) {
    if (err instanceof Error) return { ok: false, error: err.message };
    return { ok: false, error: "Error al exportar las oportunidades." };
  }
}
