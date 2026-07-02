/**
 * Helpers PUROS del panel de pago batch (TES-02 · PR-025b) — lógica extraída
 * VERBATIM del legado `saldos-batch-pago.tsx` (mantido en árbol, no importado)
 * para pasar el gate de complejidad (Codacy/Lizard). El runtime es idéntico:
 * mismos payloads byte-idénticos, misma distribución FIFO, mismo sufijo de
 * facturas (Layer-1 fallback), mismas fronteras Number↔Decimal↔toFixed(2).
 */

import Decimal from "decimal.js";

import type { AplicarPagoA } from "@/lib/actions/movimientos-tesoreria";

import type { FacturaPendiente, SaldoProveedorAging } from "./saldos-proveedores-columns";

export type LineaPago = {
  cuentaContableId: number;
  monto: string;
  descripcion: string;
  appliedTo: AplicarPagoA[] | undefined;
};

export function fmtArsNum(n: number): string {
  return n.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Sufijo de números (Layer 1 fallback — sigue siendo útil si por algún
// motivo AplicacionPago* no se grava).
export function buildSufijoFacts(facturas: FacturaPendiente[]): string {
  const numerosEspecificos = facturas
    .map((f) => f.numero)
    .filter((n) => n && !n.startsWith("Factura #"));
  return numerosEspecificos.length > 0
    ? ` — Facts: ${numerosEspecificos.slice(0, 5).join(", ")}${
        numerosEspecificos.length > 5 ? "…" : ""
      }`
    : "";
}

// Layer 0 — distribuir `monto` entre las facturas pendientes FIFO
// (más antiguas primero). Cada porción pagada se materializa como
// AplicacionPago{EmbarqueCosto|Compra|Gasto} via server action.
export function distribuirPagoFifo(facturas: FacturaPendiente[], monto: string): AplicarPagoA[] {
  let remaining = new Decimal(monto);
  const appliedTo: AplicarPagoA[] = [];
  const facturasOrdered = [...facturas].sort((a, b) => a.fecha.localeCompare(b.fecha));
  for (const f of facturasOrdered) {
    if (remaining.lte(0.005)) break;
    const facturaMonto = new Decimal(f.monto);
    const tomar = facturaMonto.gt(remaining) ? remaining : facturaMonto;
    const montoArs = tomar.toFixed(2);
    if (f.origen === "embarque") {
      appliedTo.push({ tipo: "embarqueCosto", id: Number(f.id), montoArs });
    } else if (f.origen === "compra") {
      appliedTo.push({ tipo: "compra", id: f.id, montoArs });
    } else {
      appliedTo.push({ tipo: "gasto", id: f.id, montoArs });
    }
    remaining = remaining.minus(tomar);
  }
  return appliedTo;
}

export function buildLineas(
  seleccionados: SaldoProveedorAging[],
  montosOverride: Readonly<Record<string, string>>,
): LineaPago[] {
  return seleccionados.map((p) => {
    const override = montosOverride[p.proveedorId];
    const monto = override !== undefined ? override : p.saldoTotal;
    const sufijoFacts = buildSufijoFacts(p.facturas);
    const appliedTo = distribuirPagoFifo(p.facturas, monto);
    return {
      cuentaContableId: p.cuentaContableId!,
      monto,
      descripcion: `${p.proveedorNombre}${sufijoFacts}`.slice(0, 255),
      appliedTo: appliedTo.length > 0 ? appliedTo : undefined,
    };
  });
}

export function buildDescripcionFinal(
  descripcion: string,
  seleccionados: SaldoProveedorAging[],
): string {
  return (
    descripcion ||
    `Pago múltiple — ${seleccionados.length} proveedor${
      seleccionados.length === 1 ? "" : "es"
    } (${seleccionados
      .map((p) => p.proveedorNombre)
      .slice(0, 3)
      .join(", ")}${seleccionados.length > 3 ? "…" : ""})`
  );
}

/** Monto transferido efectivo + diferencia vs subtotal (misma matemática del legado). */
export function calcDiferencia(
  conIntermediario: boolean,
  montoTransferido: string,
  subtotalFacturas: number,
): { montoTransferidoNum: number; diferencia: number } {
  const montoTransferidoNum = conIntermediario ? Number(montoTransferido) || 0 : subtotalFacturas;
  return { montoTransferidoNum, diferencia: montoTransferidoNum - subtotalFacturas };
}

/** Subtotal de facturas seleccionadas (override ?? saldoTotal; NaN → 0). */
export function calcSubtotal(
  seleccionados: SaldoProveedorAging[],
  montosOverride: Readonly<Record<string, string>>,
): number {
  return seleccionados.reduce((s, p) => {
    const override = montosOverride[p.proveedorId];
    const monto = override !== undefined ? Number(override) : Number(p.saldoTotal);
    return s + (Number.isFinite(monto) ? monto : 0);
  }, 0);
}

export function mensajeIntermediario(r: {
  asientoNumero: number;
  diferencia: string;
  tipoDiferencia: "exacto" | "anticipo" | "saldo_pendiente";
}): string {
  return r.tipoDiferencia === "anticipo"
    ? `Pago registrado (Asiento Nº ${r.asientoNumero}). Anticipo de ARS ${r.diferencia} a favor del intermediário.`
    : r.tipoDiferencia === "saldo_pendiente"
      ? `Pago registrado (Asiento Nº ${r.asientoNumero}). Quedó saldo pendiente de ARS ${Math.abs(Number(r.diferencia)).toFixed(2)} con el intermediário.`
      : `Pago registrado — Asiento Nº ${r.asientoNumero}.`;
}
