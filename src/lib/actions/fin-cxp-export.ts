"use server";

/**
 * Exportación AUDITADA de la worklist de gestión de cuentas a pagar
 * (FIN-02 · PR-026). Mirror de `cuentas-a-cobrar-export.ts` (025c): re-lee la
 * MISMA vista+moneda de la URL vía la proyección
 * `listarSaldosProveedoresWorklist` (SÓLO lectura, gate no-call — reuso 025b),
 * aplana con los MISMOS helpers puros de la page (`flattenFacturasPendientes`
 * + `filtrarPorVista` — jamás se re-deriva aging), serializa CSV/XLSX y
 * registra un evento EXPORTACION (meta-auditoría; si falla, propaga — no se
 * entrega el archivo sin registrar). La búsqueda rápida y el chip de origen
 * in-grid no se aplican (consistente con PR-010/PR-020/PR-025c).
 *
 * Gate: TODA la superficie es agregado de saldo → sin `VER_SALDO` la acción
 * NIEGA entera (re-chequeado en el servidor, no se confía en el cliente).
 *
 * Superficie de import DELIBERADAMENTE restringida a lectura + presentación +
 * serialización + auditoría: NUNCA importa `movimientos-tesoreria` /
 * `pago-exterior` / acciones de VEP / el motor de asientos. Los montos van
 * native-first: saldo nativo + conversión por fila con `convertirMonto`
 * (lección #262/#263).
 */

import {
  BUCKET_LABEL,
  type FacturaPendienteFlatRow,
  filtrarPorVista,
  flattenFacturasPendientes,
  ordenarPorUrgencia,
  resolverVista,
} from "@/app/(dashboard)/finanzas/cuentas-a-pagar/fin-cxp-presentacion";
import { auth } from "@/lib/auth";
import { requireSessionUser } from "@/lib/auth-guard";
import { toCsv } from "@/lib/export/csv";
import type { ExportColumn } from "@/lib/export/types";
import { toXlsx } from "@/lib/export/xlsx";
import { convertirMonto } from "@/lib/format";
import { puedeVerSaldo } from "@/lib/permisos-masking";
import { auditarExportacion } from "@/lib/services/auditar-exportacion";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { listarSaldosProveedoresWorklist } from "@/lib/services/saldos-proveedores-worklist";

type Formato = "csv" | "xlsx";
type MonedaPres = "ARS" | "USD";

export type ExportarFinCxpResult =
  | { ok: true; filename: string; mime: string; base64: string }
  | { ok: false; error: string };

const CSV_MIME = "text/csv;charset=utf-8";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Etiqueta legible del origen — VERBATIM de `ORIGEN_LABEL`
// (pago-por-factura.tsx, módulo "use client" no importable desde una server
// action; duplicado mínimo comentado).
const ORIGEN_EXPORT: Record<FacturaPendienteFlatRow["origen"], string> = {
  compra: "Compra",
  gasto: "Gasto",
  embarque: "Costo embarque",
};

/** Fila proyectada para el archivo: un documento pendiente, native-first. */
type FilaExport = {
  proveedor: string;
  cuit: string;
  documento: string;
  origen: string;
  referencia: string;
  fecha: string;
  vencimiento: string;
  diasAtraso: number | "";
  estado: string;
  monedaNativa: string;
  saldoNativo: string;
  saldoPres: string;
};

/** Fecha ISO → YYYY-MM-DD ("" cuando falta). */
function isoDia(fecha: string | null): string {
  if (!fecha) return "";
  return fecha.slice(0, 10);
}

/** Días de atraso para el archivo ("" cuando no está vencida). */
function diasAtrasoExport(dias: number | null): number | "" {
  if (dias === null || dias >= 0) return "";
  return -dias;
}

function proyectarFila(
  f: FacturaPendienteFlatRow,
  moneda: MonedaPres,
  tc: string | null,
): FilaExport {
  return {
    proveedor: f.proveedorNombre,
    cuit: f.cuit ?? "",
    documento: f.numero,
    origen: ORIGEN_EXPORT[f.origen],
    referencia: f.referencia ?? "",
    fecha: isoDia(f.fecha),
    vencimiento: isoDia(f.fechaVencimiento),
    diasAtraso: diasAtrasoExport(f.diasParaVencer),
    estado: BUCKET_LABEL[f.bucket],
    monedaNativa: f.moneda,
    saldoNativo: f.montoNativo,
    // Conversión por fila (una sola perna nativa por documento — sin
    // agregación acá, el redondeo por perna no aplica).
    saldoPres: convertirMonto(f.montoNativo, f.moneda as MonedaPres, moneda, tc),
  };
}

function buildColumnas(moneda: MonedaPres): ExportColumn<FilaExport>[] {
  return [
    { header: "Proveedor", value: (r) => r.proveedor },
    { header: "CUIT", value: (r) => r.cuit },
    { header: "Documento", value: (r) => r.documento },
    { header: "Origen", value: (r) => r.origen },
    { header: "Referencia", value: (r) => r.referencia },
    { header: "Fecha", value: (r) => r.fecha },
    { header: "Vencimiento", value: (r) => r.vencimiento },
    { header: "Días atraso", value: (r) => r.diasAtraso },
    { header: "Estado", value: (r) => r.estado },
    { header: "Moneda", value: (r) => r.monedaNativa },
    { header: "Saldo nativo", value: (r) => r.saldoNativo },
    { header: `Saldo (${moneda})`, value: (r) => r.saldoPres },
  ];
}

function selloFecha(): string {
  return new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
}

async function serializarExport(
  formato: Formato,
  columnas: ExportColumn<FilaExport>[],
  rows: FilaExport[],
): Promise<{ base64: string; mime: string; filename: string }> {
  const sello = selloFecha();
  if (formato === "xlsx") {
    const bytes = await toXlsx(columnas, rows, "Cuentas a pagar");
    return {
      base64: Buffer.from(bytes).toString("base64"),
      mime: XLSX_MIME,
      filename: `finanzas-cuentas-a-pagar-${sello}.xlsx`,
    };
  }
  const csv = toCsv(columnas, rows);
  return {
    base64: Buffer.from(csv, "utf8").toString("base64"),
    mime: CSV_MIME,
    filename: `finanzas-cuentas-a-pagar-${sello}.csv`,
  };
}

/** Misma derivación de moneda de presentación que la page (URL > preferencia). */
async function resolverMoneda(param: string | undefined): Promise<MonedaPres> {
  if (param === "ARS" || param === "USD") return param;
  const session = await auth();
  return session?.user.monedaPreferida === "ARS" ? "ARS" : "USD";
}

export async function exportarFinCxp(input: {
  params: { vista?: string; moneda?: string };
  formato: Formato;
}): Promise<ExportarFinCxpResult> {
  // Autenticado (FK-safe para el evento de auditoría) + gate de saldo
  // re-chequeado server-side.
  await requireSessionUser();
  const verSaldo = await puedeVerSaldo();
  if (!verSaldo) {
    return { ok: false, error: "Necesitás el permiso de saldos de tesorería para exportar." };
  }

  const proveedores = await listarSaldosProveedoresWorklist(verSaldo);
  if (!proveedores) {
    return { ok: false, error: "Necesitás el permiso de saldos de tesorería para exportar." };
  }

  const [moneda, cotizacion] = await Promise.all([
    resolverMoneda(input.params.moneda),
    getCotizacionParaFecha(new Date()),
  ]);
  const tc = cotizacion ? cotizacion.valor.toString() : null;

  // Mismos preset (`?vista=`) y orden de urgencia que la page — server-side.
  const vista = resolverVista(input.params.vista);
  const filas = filtrarPorVista(ordenarPorUrgencia(flattenFacturasPendientes(proveedores)), vista);

  const rows = filas.map((f) => proyectarFila(f, moneda, tc));
  const columnas = buildColumnas(moneda);
  const { base64, mime, filename } = await serializarExport(input.formato, columnas, rows);

  // Meta-auditoría: si falla, propaga → no se entrega el archivo sin registrar.
  await auditarExportacion({
    recurso: "finanzas-cuentas-a-pagar",
    filtros: { vista, moneda, tc },
    columnas: columnas.map((c) => c.header),
    nFilas: rows.length,
    formato: input.formato,
  });

  return { ok: true, filename, mime, base64 };
}
