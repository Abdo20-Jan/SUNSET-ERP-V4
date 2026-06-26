import "server-only";

import Decimal from "decimal.js";

import { db } from "@/lib/db";
import { puedeVerCosto } from "@/lib/permisos-masking";
import { calcularMargenNetoVenta, sumarCostoItems } from "@/lib/services/margen-aprobacion-faixas";

/**
 * Reader de margen autorizado para el Resumen del record de Venta (PR-018).
 *
 * NO recalcula con criterio propio ni toca el motor: REUSA el cálculo canónico
 * `calcularMargenNetoVenta` (espelho de `venta-form.tsx`) y la suma de costos
 * `sumarCostoItems`. Sólo DERIVA, para una venta YA guardada, los números que el
 * form muestra en vivo durante la edición.
 *
 * PR-011 (doble capa): si la sesión no puede ver el costo, devuelve `null` acá
 * (BE = única protección real, CRIT-10); el caller además gatea el render del
 * bloque con `puedeVerMargen()`. El valor neto se back-calcula del % canónico
 * (`valor = subtotal × pct / 100`) — álgebra trivial, sin re-derivar la provisión.
 */
export type MargenVentaResumen = {
  /** Margen neto en % (2 decimales). */
  margenNetoPct: string;
  /** Margen neto en valor, en la moneda de la venta (2 decimales). */
  margenNetoValor: string;
};

type ItemConProducto = { cantidad: number; productoId: string };

/**
 * Suma `cantidad × costoPromedio` reusando `sumarCostoItems`. Devuelve `null`
 * cuando algún ítem no tiene costo cargado (igual que el form: sin costo, no hay
 * margen calculable). Extraído para mantener la complejidad ciclomática ≤ 8.
 */
function resolverCostoTotal(
  items: readonly ItemConProducto[],
  costoPorProducto: ReadonlyMap<string, string | null>,
): Decimal | null {
  const itemsConCosto: { cantidad: number; costoPromedio: string }[] = [];
  for (const it of items) {
    const costo = costoPorProducto.get(it.productoId);
    if (costo == null) return null;
    itemsConCosto.push({ cantidad: it.cantidad, costoPromedio: costo });
  }
  return sumarCostoItems(itemsConCosto);
}

export async function obtenerMargenVentaParaResumen(
  ventaId: string,
): Promise<MargenVentaResumen | null> {
  // PR-011: sin `costos.ver` no hay costo → no se puede derivar margen → null.
  if (!(await puedeVerCosto())) return null;

  const venta = await db.venta.findUnique({
    where: { id: ventaId },
    select: {
      subtotal: true,
      flete: true,
      percepcionIIBB: true,
      items: { select: { cantidad: true, productoId: true } },
    },
  });
  if (!venta) return null;

  const productos = await db.producto.findMany({
    where: { id: { in: venta.items.map((it) => it.productoId) } },
    select: { id: true, costoPromedio: true },
  });
  const costoPorProducto = new Map<string, string | null>(
    productos.map((p) => [p.id, p.costoPromedio != null ? p.costoPromedio.toString() : null]),
  );

  const items = venta.items.map((it) => ({
    cantidad: Number(it.cantidad),
    productoId: it.productoId,
  }));
  const costoTotal = resolverCostoTotal(items, costoPorProducto);
  if (costoTotal == null || costoTotal.lte(0)) return null;

  const subtotal = new Decimal(venta.subtotal.toString());
  const margenNetoPct = calcularMargenNetoVenta({
    subtotal,
    costoTotal,
    flete: venta.flete.toString(),
    percepcionIIBB: venta.percepcionIIBB.toString(),
  });
  const margenNetoValor = subtotal.times(margenNetoPct).dividedBy(100).toDecimalPlaces(2);

  return {
    margenNetoPct: margenNetoPct.toFixed(2),
    margenNetoValor: margenNetoValor.toString(),
  };
}
