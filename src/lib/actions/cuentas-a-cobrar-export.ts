"use server";

/**
 * Exportación AUDITADA de la worklist de cuentas a cobrar (TES-03 · PR-025c).
 *
 * Mirror de `exportarEmbarques`/`exportarAuditoria`: re-lee la MISMA
 * vista+moneda de la URL vía la proyección `listarCuentasACobrarWorklist`
 * (SÓLO lectura, gate no-call), serializa CSV/XLSX y registra un evento
 * EXPORTACION (meta-auditoría; si falla, propaga — no se entrega el archivo
 * sin registrar). Reproduce los filtros de SERVIDOR (`filtro=vencidas` +
 * moneda de presentación); la búsqueda rápida in-grid no se aplica
 * (consistente con PR-010/PR-020).
 *
 * Gate: TODA la superficie es agregado de saldo → sin `VER_SALDO` la acción
 * NIEGA entera (espejo de la omisión página-inteira de la page; re-chequeado
 * en el servidor, no se confía en el cliente). Sin permiso de exportación
 * dedicado en el catálogo (mismo gap documentado de Comex/PR-020) — la acción
 * queda autenticada + gateada por `VER_SALDO` + auditada.
 *
 * Superficie de import DELIBERADAMENTE restringida a lectura + presentación +
 * serialización + auditoría: NUNCA importa `movimientos-tesoreria` / el motor
 * de asientos. Los montos se convierten con los MISMOS helpers de la page
 * (`sumarBucketsNativos`/`convertirBucket` — lección #262/#263, native-first).
 */

import { mayorAtrasoDias } from "@/app/(dashboard)/tesoreria/cuentas-a-cobrar/cuentas-a-cobrar-presentacion";
import { convertirBucket, sumarBucketsNativos } from "@/lib/aging-presentacion";
import { auth } from "@/lib/auth";
import { requireSessionUser } from "@/lib/auth-guard";
import { toDecimal } from "@/lib/decimal";
import { toCsv } from "@/lib/export/csv";
import type { ExportColumn } from "@/lib/export/types";
import { toXlsx } from "@/lib/export/xlsx";
import { convertirMonto, pickSaldoNativo } from "@/lib/format";
import { puedeVerSaldo } from "@/lib/permisos-masking";
import { auditarExportacion } from "@/lib/services/auditar-exportacion";
import { listarCuentasACobrarWorklist } from "@/lib/services/cuentas-a-cobrar-worklist";
import type { SaldoClienteAging } from "@/lib/services/cuentas-a-cobrar";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";

type Formato = "csv" | "xlsx";
type MonedaPres = "ARS" | "USD";

export type ExportarCuentasACobrarResult =
  | { ok: true; filename: string; mime: string; base64: string }
  | { ok: false; error: string };

const CSV_MIME = "text/csv;charset=utf-8";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Fila proyectada para el archivo: buckets ya convertidos native-first. */
type FilaExport = {
  cliente: string;
  cuit: string;
  cuenta: string;
  vencido: string;
  proximo: string;
  alDia: string;
  mayorAtrasoDias: number | "";
  facturas: number;
  saldoContable: string;
};

/** Convierte los agregados del cliente con los MISMOS helpers de la page. */
function proyectarFila(c: SaldoClienteAging, moneda: MonedaPres, tc: string | null): FilaExport {
  const buckets = sumarBucketsNativos(
    c.ventas.map((v) => ({ bucket: v.bucket, moneda: v.moneda, montoNativo: v.montoNativo })),
  );
  const pick = pickSaldoNativo(c.saldoTotal, c.saldoTotalUsd);
  return {
    cliente: c.clienteNombre,
    cuit: c.cuit ?? "",
    cuenta: c.cuentaCodigo ?? "",
    vencido: convertirBucket(buckets.vencida, moneda, tc),
    proximo: convertirBucket(buckets.proxima, moneda, tc),
    alDia: convertirBucket(buckets.al_dia, moneda, tc),
    // Mismo helper puro que la columna del grid (no re-deriva aging).
    mayorAtrasoDias: mayorAtrasoDias(c.ventas) ?? "",
    facturas: c.ventas.length,
    saldoContable: convertirMonto(pick.valor, pick.monedaNativa, moneda, tc),
  };
}

function buildColumnas(moneda: MonedaPres): ExportColumn<FilaExport>[] {
  return [
    { header: "Cliente", value: (r) => r.cliente },
    { header: "CUIT", value: (r) => r.cuit },
    { header: "Cuenta", value: (r) => r.cuenta },
    { header: `Vencido (${moneda})`, value: (r) => r.vencido },
    { header: `A vencer 7d (${moneda})`, value: (r) => r.proximo },
    { header: `Al día (${moneda})`, value: (r) => r.alDia },
    { header: "Mayor atraso (días)", value: (r) => r.mayorAtrasoDias },
    { header: "Facturas pendientes", value: (r) => r.facturas },
    { header: `Saldo contable (${moneda})`, value: (r) => r.saldoContable },
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
    const bytes = await toXlsx(columnas, rows, "Cuentas a cobrar");
    return {
      base64: Buffer.from(bytes).toString("base64"),
      mime: XLSX_MIME,
      filename: `cuentas-a-cobrar-${sello}.xlsx`,
    };
  }
  const csv = toCsv(columnas, rows);
  return {
    base64: Buffer.from(csv, "utf8").toString("base64"),
    mime: CSV_MIME,
    filename: `cuentas-a-cobrar-${sello}.csv`,
  };
}

/** Misma derivación de moneda de presentación que la page (URL > preferencia). */
async function resolverMoneda(param: string | undefined): Promise<MonedaPres> {
  if (param === "ARS" || param === "USD") return param;
  const session = await auth();
  return session?.user.monedaPreferida === "ARS" ? "ARS" : "USD";
}

export async function exportarCuentasACobrar(input: {
  params: { filtro?: string; moneda?: string };
  formato: Formato;
}): Promise<ExportarCuentasACobrarResult> {
  // Autenticado (FK-safe para el evento de auditoría) + gate de saldo
  // re-chequeado server-side.
  await requireSessionUser();
  const verSaldo = await puedeVerSaldo();
  if (!verSaldo) {
    return { ok: false, error: "Necesitás el permiso de saldos de tesorería para exportar." };
  }

  const data = await listarCuentasACobrarWorklist(verSaldo);
  if (!data) {
    return { ok: false, error: "Necesitás el permiso de saldos de tesorería para exportar." };
  }

  const [moneda, cotizacion] = await Promise.all([
    resolverMoneda(input.params.moneda),
    getCotizacionParaFecha(new Date()),
  ]);
  const tc = cotizacion ? cotizacion.valor.toString() : null;

  // Mismo preset server-side que la page (`?filtro=vencidas`).
  const filtro = input.params.filtro === "vencidas" ? "vencidas" : null;
  const clientes = filtro ? data.clientes.filter((c) => toDecimal(c.vencido).gt(0)) : data.clientes;

  const rows = clientes.map((c) => proyectarFila(c, moneda, tc));
  const columnas = buildColumnas(moneda);
  const { base64, mime, filename } = await serializarExport(input.formato, columnas, rows);

  // Meta-auditoría: si falla, propaga → no se entrega el archivo sin registrar.
  await auditarExportacion({
    recurso: "cuentas-a-cobrar",
    filtros: { filtro, moneda, tc },
    columnas: columnas.map((c) => c.header),
    nFilas: rows.length,
    formato: input.formato,
  });

  return { ok: true, filename, mime, base64 };
}
