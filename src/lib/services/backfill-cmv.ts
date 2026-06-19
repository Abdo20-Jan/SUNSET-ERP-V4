/**
 * Onda E #4 — lógica pura del backfill de `ItemVenta.costoUnitarioCmv` para las
 * ventas legacy (snapshot 0) con la cuenta-puente 1.1.7.90 MERCADERÍAS A
 * ENTREGAR abierta (stock-dual W3).
 *
 * Contexto: al emitir, crearAsientoVenta hace DEBE CMV / HABER 1.1.7.90 por
 * `Σ cantidad × Producto.costoPromedio` y guarda ese costoPromedio por ítem en
 * `ItemVenta.costoUnitarioCmv`. La entrega cancela 1.1.7.90 por ESE snapshot,
 * así el puente cierra exacto sin importar cómo evolucionó el costoPromedio.
 * Las ventas anteriores al snapshot tienen `costoUnitarioCmv = 0` (default) y la
 * entrega cae al costo SPD del momento → si el costoPromedio derivó, deja un
 * residuo en 1.1.7.90.
 *
 * El valor FIEL al runtime es el `Producto.costoPromedio AL MOMENTO DE LA
 * EMISIÓN`. Se reproduce replayando los MovimientoStock NACIONAL hasta la fecha
 * de emisión (reusa `replayStockNacional` del #14, única fuente de verdad del
 * replay). El total por venta se AUTO-VERIFICA contra la provisión que la
 * emisión acreditó a 1.1.7.90 (g.haber): si no coincide, hay drift de datos y
 * la venta se marca para revisión manual en vez de backfillearse a ciegas.
 *
 * Sin `import "server-only"`: este módulo se importa desde scripts de `prisma/`
 * (tsx) y desde el runtime por igual.
 */

import { type MoneyInput, toDecimal } from "@/lib/decimal";
import { type MovimientoStockReplay, replayStockNacional } from "@/lib/services/stock-recalc";
import Decimal from "decimal.js";

/** Movimiento de stock con su fecha, para cortar el replay en la emisión. */
export type MovimientoFechado = MovimientoStockReplay & { fecha: Date };

/**
 * Reproduce el `Producto.costoPromedio` vendible (sólo depósitos NACIONAL) tal
 * como estaba al `corte` (la fecha de emisión de la venta), replayando los
 * movimientos con `fecha <= corte`. El corte es INCLUSIVO: un movimiento
 * fechado exactamente en el corte ya estaba aplicado al emitir.
 *
 * `movimientos` debe venir ordenado por (fecha, id) — el mismo orden que usa el
 * runtime — para que el promedio ponderado sea reproducible.
 */
export function costoPromedioEnFecha(
  movimientos: readonly MovimientoFechado[],
  corte: Date,
): Decimal {
  const hasta = movimientos.filter((m) => m.fecha.getTime() <= corte.getTime());
  return replayStockNacional(hasta).promedio;
}

/** Un ítem de venta legacy con los dos candidatos de costo para el backfill. */
export type ItemBackfillCmv = {
  itemVentaId: number;
  cantidad: number;
  /** Producto.costoPromedio HOY (lo que usaría el fallback legacy al entregar). */
  costoUnitarioActual: MoneyInput;
  /** costoPromedio reproducido a la fecha de emisión — el valor fiel al runtime. */
  costoUnitarioEmision: MoneyInput;
};

/** Resultado de reconciliar el backfill de una venta contra su provisión. */
export type ReconciliacionVenta = {
  /** Σ cantidad × costoUnitarioEmision — lo que la entrega debitaría tras el backfill. */
  totalEmision: Decimal;
  /** Σ cantidad × costoUnitarioActual — referencia (comportamiento sin backfill). */
  totalActual: Decimal;
  /** g.haber: lo que la emisión acreditó a 1.1.7.90 para esta venta. */
  provisionEsperada: Decimal;
  /** totalEmision − provisionEsperada. Cero ⇒ el backfill cierra el puente exacto. */
  delta: Decimal;
  /** |delta| <= tolerancia ⇒ el replay reprodujo la provisión; backfill seguro. */
  ok: boolean;
};

/**
 * Verifica que backfillear `costoUnitarioEmision` por ítem deja la venta
 * cerrando 1.1.7.90 exacto contra su provisión de emisión. La tolerancia
 * absorbe redondeos de centavo acumulados al sumar por ítem.
 */
export function reconciliarVenta(
  items: readonly ItemBackfillCmv[],
  provisionEsperada: MoneyInput,
  toleranciaCentavos = 1,
): ReconciliacionVenta {
  const totalEmision = items
    .reduce(
      (acc, it) => acc.plus(toDecimal(it.costoUnitarioEmision).times(it.cantidad)),
      new Decimal(0),
    )
    .toDecimalPlaces(2);
  const totalActual = items
    .reduce(
      (acc, it) => acc.plus(toDecimal(it.costoUnitarioActual).times(it.cantidad)),
      new Decimal(0),
    )
    .toDecimalPlaces(2);
  const provision = toDecimal(provisionEsperada).toDecimalPlaces(2);
  const delta = totalEmision.minus(provision);
  const tolerancia = new Decimal(toleranciaCentavos).dividedBy(100);
  return {
    totalEmision,
    totalActual,
    provisionEsperada: provision,
    delta,
    ok: delta.abs().lessThanOrEqualTo(tolerancia),
  };
}
