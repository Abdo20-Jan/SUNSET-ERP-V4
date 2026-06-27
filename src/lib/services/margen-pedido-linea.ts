// Margen por línea para la grade del record de Pedido (PR-019). PURO y client-safe
// (SIN `server-only`): REUSA los helpers canónicos `sumarCostoItems` y
// `calcularMargenNetoVenta` (margen-aprobacion-faixas) — NO recalcula con criterio
// propio ni toca el motor. El pedido no tiene flete ni percepción IIBB (no están en
// el schema de PedidoVenta), por eso ambos entran en 0. El valor neto se back-calcula
// del % canónico (`subtotalLinea × pct / 100`), igual que el reader de venta.

import Decimal from "decimal.js";

import { calcularMargenNetoVenta, sumarCostoItems } from "@/lib/services/margen-aprobacion-faixas";

export type MargenLineaPedido = {
  /** Margen neto en % (2 decimales). */
  margenPct: string;
  /** Margen neto en valor, en la moneda del pedido (2 decimales). */
  margenValor: string;
};

/**
 * Margen neto de una línea del pedido. Devuelve `null` cuando no hay costo cargado
 * (igual que el form: sin costo no hay margen calculable) o el subtotal es 0.
 */
export function calcularMargenLineaPedido(args: {
  precioUnitario: string;
  cantidad: number;
  costoPromedio: string | null;
}): MargenLineaPedido | null {
  if (args.costoPromedio == null) return null;
  const subtotal = new Decimal(args.precioUnitario).times(args.cantidad).toDecimalPlaces(2);
  if (subtotal.lte(0)) return null;

  const costoTotal = sumarCostoItems([
    { cantidad: args.cantidad, costoPromedio: args.costoPromedio },
  ]);
  if (costoTotal.lte(0)) return null;

  const margenPct = calcularMargenNetoVenta({
    subtotal,
    costoTotal,
    flete: 0,
    percepcionIIBB: 0,
  });
  const margenValor = subtotal.times(margenPct).dividedBy(100).toDecimalPlaces(2);

  return {
    margenPct: margenPct.toFixed(2),
    margenValor: margenValor.toString(),
  };
}
