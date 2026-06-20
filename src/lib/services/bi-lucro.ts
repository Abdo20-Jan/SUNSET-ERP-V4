import "server-only";

import { toDecimal } from "@/lib/decimal";
import { AsientoEstado, CuentaTipo } from "@/generated/prisma/client";
import { db } from "@/lib/db";

import { getMargenesDimensionales, type DateRange, type MargenesDimensionales } from "./bi";
import { calcularLucro, type LucroIndicadores, type LucroInputs } from "./bi-lucro-formulas";
import { getEstadoResultadosByFecha } from "./reportes/estado-resultados";
import type { ConceptoDREId } from "./reportes/estado-resultados-rt9";

/**
 * Depreciación + amortización (clase 7, dentro de Gastos de administración).
 * Las 4 analíticas 7.7.0x (bienes de uso / intangibles, admin + comercial) caen
 * todas bajo este prefijo → se reincorporan al EBIT para el EBITDA.
 */
const PREFIJO_DEP_AMORT = "7.7.";

export type AnalisisLucro = {
  indicadores: LucroIndicadores;
  /** Insumos crudos (moneda base ARS) de la cascada, para transparencia. */
  inputs: LucroInputs;
  /** Lente operativa por dimensión (canal/marca/producto), al costo promedio. */
  dimensionales: MargenesDimensionales;
};

/**
 * Indicadores de lucro / rentabilidad (familia MAR) del período.
 *
 * La cascada (Resultado bruto → EBIT → EBITDA → Resultado neto) sale de la
 * verdad contable del razón vía `getEstadoResultadosByFecha` (cascada RT9), de
 * modo que reconcilia 1:1 con el Estado de Resultados de Reportes. El EBIT se
 * arma sumando los conceptos operativos (la cascada no emite un subtotal
 * operativo); el EBITDA reincorpora la D&A del prefijo "7.7.".
 *
 * Las márgenes por dimensión vienen de `getMargenesDimensionales` (costo
 * promedio operativo) — otra lente, no necesariamente conciliable con la
 * cascada (ver "dos verdades de CMV"). Sin cambios de schema.
 */
export async function getAnalisisLucro(rng: DateRange): Promise<AnalisisLucro> {
  const [er, daAgg, dimensionales] = await Promise.all([
    getEstadoResultadosByFecha({
      fechaDesde: rng.desde ?? undefined,
      fechaHasta: rng.hasta ?? undefined,
    }),
    db.lineaAsiento.aggregate({
      where: {
        asiento: { estado: AsientoEstado.CONTABILIZADO },
        cuenta: { tipo: CuentaTipo.ANALITICA, codigo: { startsWith: PREFIJO_DEP_AMORT } },
      },
      _sum: { debe: true, haber: true },
    }),
    getMargenesDimensionales(rng),
  ]);

  // Totales (con signo: + aumenta la ganancia) de la cascada RT9, por concepto.
  const totalPorId = new Map<ConceptoDREId, number>(
    er.rt9.conceptos.map((c) => [c.id, c.total.toNumber()]),
  );
  const get = (id: ConceptoDREId): number => totalPorId.get(id) ?? 0;

  const ventas = get("INGRESOS_NETOS");
  const resultadoBruto = get("RESULTADO_BRUTO");
  // EBIT = bruto − comercialización − administración − otros operativos (los
  // gastos contribuyen con signo negativo, así que se suman).
  const ebit =
    resultadoBruto +
    get("GASTOS_COMERCIALIZACION") +
    get("GASTOS_ADMINISTRACION") +
    get("OTROS_GASTOS_OPERATIVOS");
  // D&A: saldo deudor = debe − haber (positivo, es un gasto).
  const depreciacionAmortizacion = toDecimal(daAgg._sum.debe ?? 0)
    .minus(toDecimal(daAgg._sum.haber ?? 0))
    .toNumber();
  const resultadoNeto = er.rt9.resultadoEjercicio.toNumber();

  const inputs: LucroInputs = {
    ventas,
    resultadoBruto,
    ebit,
    depreciacionAmortizacion,
    resultadoNeto,
  };

  return { indicadores: calcularLucro(inputs), inputs, dimensionales };
}
