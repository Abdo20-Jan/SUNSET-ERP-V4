/**
 * Helpers PUROS de presentación de la worklist de cuentas a cobrar
 * (TES-03 · PR-025c). Client-safe: Decimal + `@/lib/format` puros, sin
 * `@/lib/aging-presentacion` (server-side, arrastra Prisma al bundle).
 *
 * `fmtBucketPres` replica client-safe la MISMA vía que la page legada usaba
 * por cliente (`fmtMoney(convertirBucket(sumarBucketsNativos(ventas)[b]))`):
 * suma por moneda NATIVA antes de convertir (lección #262/#263), `sin_fecha`
 * colapsa en `al_dia`, y — clave — el redondeo es POR PERNA (una vez por
 * moneda), no por item. Deliberadamente NO copia la variante per-item de
 * `saldos-proveedores-columns.tsx` (025b): con varias ventas de la misma
 * moneda en un bucket, redondear por item deriva 1 centavo del KPI/legado
 * (lección "alinear granularidad de redondeo helper agregado vs granular").
 * La equivalencia con los helpers server-side está trabada por el test de
 * paridad (`test/cuentas-a-cobrar-worklist.test.ts`) — no editar una sin la
 * otra. Sin RTL en el repo → TDD vía helpers puros (módulo sin JSX).
 */

import Decimal from "decimal.js";

import { convertirMonto, fmtMoney } from "@/lib/format";
import type { Moneda } from "../../reportes/_components/moneda-toggle";

// Shapes client-safe, idénticos a los del servicio `cuentas-a-cobrar.ts`
// (server-only, no importable desde "use client" — precedente 025b).
export type VentaPendienteRow = {
  id: string;
  numero: string;
  fecha: string;
  fechaVencimiento: string | null;
  diasParaVencer: number | null; // negativo = vencida hace N días
  bucket: "vencida" | "proxima" | "al_dia" | "sin_fecha";
  monto: string; // ARS (legado)
  montoNativo: string; // pendiente en la moneda NATIVA de la venta
  moneda: string;
};

export type SaldoClienteAgingRow = {
  clienteId: string;
  clienteNombre: string;
  cuit: string | null;
  cuentaContableId: number | null;
  cuentaCodigo: string | null;
  saldoTotal: string; // ARS contable — la verdad
  saldoTotalUsd?: string; // USD nativo — para pickSaldoNativo
  vencido: string;
  proximo: string;
  alDia: string;
  ventas: VentaPendienteRow[];
};

// Suma los pendientes de un bucket POR MONEDA NATIVA y los convierte a la
// moneda de presentación (lección #262/#263). Espejo aritmético exacto de
// `convertirBucket(sumarBucketsNativos(ventas)[bucket])`: acumula cada perna
// nativa y convierte/redondea UNA vez por perna (nunca por item).
export function fmtBucketPres(
  ventas: Array<Pick<VentaPendienteRow, "bucket" | "moneda" | "montoNativo">>,
  bucket: VentaPendienteRow["bucket"],
  moneda: Moneda,
  tc: string | null,
): string {
  let ars = new Decimal(0);
  let usd = new Decimal(0);
  for (const v of ventas) {
    // sin_fecha colapsa en al_dia (paridad con el servicio legado).
    const vb = v.bucket === "sin_fecha" ? "al_dia" : v.bucket;
    if (vb !== bucket) continue;
    if (v.moneda === "USD") usd = usd.plus(v.montoNativo);
    else ars = ars.plus(v.montoNativo);
  }
  const arsConv = convertirMonto(ars.toFixed(2), "ARS", moneda, tc);
  const usdConv = convertirMonto(usd.toFixed(2), "USD", moneda, tc);
  return fmtMoney(new Decimal(arsConv).plus(usdConv).toFixed(2));
}

/**
 * Mayor atraso del cliente en días (positivo), derivado de `diasParaVencer`
 * (negativo = vencida hace N días) de las ventas pendientes. `null` cuando no
 * hay ninguna vencida. Sólo presentación — no re-deriva aging (los buckets ya
 * vienen clasificados del servicio).
 */
export function mayorAtrasoDias(
  ventas: Array<Pick<VentaPendienteRow, "bucket" | "diasParaVencer">>,
): number | null {
  let mayor: number | null = null;
  for (const v of ventas) {
    if (v.bucket !== "vencida" || v.diasParaVencer === null) continue;
    const atraso = -v.diasParaVencer;
    if (atraso > 0 && (mayor === null || atraso > mayor)) mayor = atraso;
  }
  return mayor;
}

/**
 * URL del CTA "Cobrar" — VERBATIM de `ClienteCard` (page.tsx legado): link
 * pre-llenado al flujo EXISTENTE de movimientos (nunca un engine de cobranza
 * propio; este PR no agrega mutación alguna).
 */
export function cobrarHref(
  cliente: Pick<SaldoClienteAgingRow, "saldoTotal" | "clienteNombre" | "cuentaContableId">,
): string {
  const params = new URLSearchParams({
    tipo: "COBRO",
    monto: cliente.saldoTotal,
    descripcion: `Cobro de ${cliente.clienteNombre}`,
  });
  if (cliente.cuentaContableId != null) {
    params.set("cuentaContableId", String(cliente.cuentaContableId));
  }
  return `/tesoreria/movimientos/nuevo?${params.toString()}`;
}
