import "server-only";

import Decimal from "decimal.js";

import { db } from "@/lib/db";
import { puedeVerCosto } from "@/lib/permisos-masking";
import { calcularMargenNetoVenta, sumarCostoItems } from "@/lib/services/margen-aprobacion-faixas";

/**
 * Reader de margen total autorizado para el Resumen del record de Pedido (PR-019).
 *
 * Espejo de `margen-venta-resumen.ts`: NO recalcula con criterio propio ni toca el
 * motor — REUSA `calcularMargenNetoVenta` + `sumarCostoItems`. El pedido no tiene
 * subtotal almacenado (se deriva de los ítems: Σ precioUnitario × cantidad) ni flete
 * / percepción IIBB (no están en el schema), por eso ambos entran en 0. El valor neto
 * se back-calcula del % (`subtotal × pct / 100`).
 *
 * PR-011 (doble capa): sin `costos.ver` devuelve `null` acá (BE = única protección
 * real); el caller además gatea el render con `puedeVerMargen()`.
 */
export type MargenPedidoResumen = {
  /** Margen neto en % (2 decimales). */
  margenNetoPct: string;
  /** Margen neto en valor, en la moneda del pedido (2 decimales). */
  margenNetoValor: string;
};

type ItemConProducto = { cantidad: number; productoId: string };

/**
 * Suma `cantidad × costoPromedio` reusando `sumarCostoItems`. Devuelve `null` cuando
 * algún ítem no tiene costo cargado. Extraído para mantener la complejidad ≤ 8.
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

export async function obtenerMargenPedidoParaResumen(
  pedidoId: number,
): Promise<MargenPedidoResumen | null> {
  // PR-011: sin `costos.ver` no hay costo → no se puede derivar margen → null.
  if (!(await puedeVerCosto())) return null;

  const pedido = await db.pedidoVenta.findUnique({
    where: { id: pedidoId },
    select: { items: { select: { cantidad: true, precioUnitario: true, productoId: true } } },
  });
  if (!pedido || pedido.items.length === 0) return null;

  const productos = await db.producto.findMany({
    where: { id: { in: pedido.items.map((it) => it.productoId) } },
    select: { id: true, costoPromedio: true },
  });
  const costoPorProducto = new Map<string, string | null>(
    productos.map((p) => [p.id, p.costoPromedio != null ? p.costoPromedio.toString() : null]),
  );

  const items = pedido.items.map((it) => ({
    cantidad: Number(it.cantidad),
    productoId: it.productoId,
  }));
  const costoTotal = resolverCostoTotal(items, costoPorProducto);
  if (costoTotal == null || costoTotal.lte(0)) return null;

  // El pedido no almacena subtotal: se deriva de los ítems (sin IVA, igual que el form).
  const subtotal = pedido.items.reduce<Decimal>(
    (acc, it) => acc.plus(new Decimal(it.precioUnitario.toString()).times(it.cantidad)),
    new Decimal(0),
  );
  if (subtotal.lte(0)) return null;

  const margenNetoPct = calcularMargenNetoVenta({
    subtotal,
    costoTotal,
    flete: 0,
    percepcionIIBB: 0,
  });
  const margenNetoValor = subtotal.times(margenNetoPct).dividedBy(100).toDecimalPlaces(2);

  return {
    margenNetoPct: margenNetoPct.toFixed(2),
    margenNetoValor: margenNetoValor.toString(),
  };
}
