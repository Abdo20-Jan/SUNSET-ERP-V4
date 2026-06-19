import "server-only";

import { db } from "@/lib/db";
import { Decimal, toDecimal } from "@/lib/decimal";
import { AsientoEstado } from "@/generated/prisma/client";

import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import {
  construirEstadoResultadosRT9,
  type EstadoResultadosRT9,
  type LeafResultado,
} from "./estado-resultados-rt9";
import { calcularRevaluacionUsd } from "./revaluacion";
import { buildCuentaTree, type CuentaTreeNode, type ReporteFilter } from "./shared";

// Campos de moneda comunes al Balance/ER (revaluación al TC de cierre).
export type MonedaReporte = {
  /** Resultado de la revaluación de posiciones USD al cierre (ARS, +ganancia). */
  difCambioNoRealizada: Decimal;
  tipoCambioCierre: Decimal | null;
  fechaCotizacionCierre: Date | null;
  advertencias: string[];
};

export type EstadoResultadosResult = {
  periodo: {
    id: number;
    codigo: string;
    nombre: string;
    fechaInicio: Date;
    fechaFin: Date;
  };
  ingresos: CuentaTreeNode[];
  egresos: CuentaTreeNode[];
  totalIngresos: Decimal;
  totalEgresos: Decimal;
  resultado: Decimal;
  /** Cascada de exposición RT9 (Bruto → Operativo → … → Ejercicio). */
  rt9: EstadoResultadosRT9;
} & MonedaReporte;

// Id sintético (negativo, sin colisión) del nodo de diferencia de cambio no
// realizada que se inserta en la lista de ingresos/egresos para exhibición.
const DIF_CAMBIO_NODE_ID = -960;

/**
 * Agrega las cuentas analíticas de resultado (INGRESO/EGRESO) por el mismo
 * filtro temporal del reporte y arma la cascada RT9. Usa el `rubroEECC` de
 * cada cuenta (manda sobre el código) para clasificar la sección. Si hay
 * revaluación no realizada (`difCambioNoRealizada` ≠ 0), inyecta una hoja
 * sintética en la sección FINANCIEROS (se suma a la diferencia de cambio
 * REALIZADA de las cuentas reales, sin doble conteo).
 */
async function buildEstadoResultadosRT9(
  filter: ReporteFilter,
  difCambioNoRealizada: Decimal = new Decimal(0),
): Promise<EstadoResultadosRT9> {
  const asientoWhere =
    "periodoId" in filter
      ? { estado: AsientoEstado.CONTABILIZADO, periodoId: filter.periodoId }
      : {
          estado: AsientoEstado.CONTABILIZADO,
          ...(filter.fechaDesde || filter.fechaHasta
            ? {
                fecha: {
                  ...(filter.fechaDesde && { gte: filter.fechaDesde }),
                  ...(filter.fechaHasta && { lte: filter.fechaHasta }),
                },
              }
            : {}),
        };

  const [cuentas, agregados] = await Promise.all([
    db.cuentaContable.findMany({
      where: { tipo: "ANALITICA", categoria: { in: ["INGRESO", "EGRESO"] } },
      select: { id: true, codigo: true, categoria: true, rubroEECC: true },
    }),
    db.lineaAsiento.groupBy({
      by: ["cuentaId"],
      where: { asiento: asientoWhere, cuenta: { categoria: { in: ["INGRESO", "EGRESO"] } } },
      _sum: { debe: true, haber: true },
    }),
  ]);

  const aggPorCuenta = new Map(agregados.map((a) => [a.cuentaId, a._sum]));

  const leaves: LeafResultado[] = cuentas.map((c) => {
    const agg = aggPorCuenta.get(c.id);
    return {
      codigo: c.codigo,
      categoria: c.categoria as "INGRESO" | "EGRESO",
      rubroEECC: c.rubroEECC,
      debe: toDecimal(agg?.debe ?? 0),
      haber: toDecimal(agg?.haber ?? 0),
    };
  });

  if (!difCambioNoRealizada.isZero()) {
    const esGanancia = difCambioNoRealizada.gte(0);
    // Contribución haber−debe = difCambioNoRealizada (con signo).
    leaves.push({
      // Diferencia de cambio NO realizada (revaluación al cierre), clase 9.2.
      codigo: esGanancia ? "9.2.03" : "9.2.04",
      categoria: esGanancia ? "INGRESO" : "EGRESO",
      rubroEECC: "Resultados financieros y de tenencia",
      debe: esGanancia ? new Decimal(0) : difCambioNoRealizada.abs(),
      haber: esGanancia ? difCambioNoRealizada : new Decimal(0),
    });
  }

  return construirEstadoResultadosRT9(leaves);
}

// Nodo sintético "Diferencia de cambio no realizada" para la lista de
// ingresos (ganancia) o egresos (pérdida). Sólo presentación.
function nodoDifCambio(total: Decimal): CuentaTreeNode {
  const saldo = total.abs().toDecimalPlaces(2);
  const esGanancia = total.gte(0);
  return {
    id: DIF_CAMBIO_NODE_ID,
    codigo: "—",
    nombre: "Diferencia de cambio no realizada (revalúo al cierre)",
    tipo: "ANALITICA",
    categoria: esGanancia ? "INGRESO" : "EGRESO",
    nivel: 4,
    rubroEECC: "Resultados financieros y de tenencia",
    saldoInicial: new Decimal(0),
    debe: esGanancia ? new Decimal(0) : saldo,
    haber: esGanancia ? saldo : new Decimal(0),
    saldo,
    children: [],
  };
}

/**
 * Núcleo compartido por las variantes por período y por fecha. `hasta` es la
 * fecha de cierre para el TC y la revaluación (foto al cierre acumulada).
 */
async function armarEstadoResultados(
  reportFilter: ReporteFilter,
  hasta: Date | undefined,
): Promise<Omit<EstadoResultadosResult, "periodo">> {
  const tcRow = await getCotizacionParaFecha(hasta ?? new Date());
  const tipoCambioCierre = tcRow?.valor ?? null;
  const fechaCotizacionCierre = tcRow?.fecha ?? null;

  const rev = await calcularRevaluacionUsd(hasta, tipoCambioCierre);

  const [tree, rt9] = await Promise.all([
    buildCuentaTree(["INGRESO", "EGRESO"], reportFilter),
    buildEstadoResultadosRT9(reportFilter, rev.total),
  ]);

  // Copia defensiva: empujamos el nodo sintético de dif. de cambio sin mutar
  // los arrays internos del árbol.
  const ingresos = [...(tree.porCategoria.get("INGRESO") ?? [])];
  const egresos = [...(tree.porCategoria.get("EGRESO") ?? [])];
  let totalIngresos = tree.totalPorCategoria.get("INGRESO") ?? new Decimal(0);
  let totalEgresos = tree.totalPorCategoria.get("EGRESO") ?? new Decimal(0);

  if (!rev.total.isZero()) {
    const nodo = nodoDifCambio(rev.total);
    if (rev.total.gte(0)) {
      ingresos.push(nodo);
      totalIngresos = totalIngresos.plus(nodo.saldo);
    } else {
      egresos.push(nodo);
      totalEgresos = totalEgresos.plus(nodo.saldo);
    }
  }

  const advertencias: string[] = [];
  if (tipoCambioCierre === null && rev.hayPosiciones) {
    advertencias.push(
      "No hay cotización para la fecha de cierre; las posiciones en moneda extranjera no se revaluaron.",
    );
  }

  return {
    ingresos,
    egresos,
    totalIngresos: totalIngresos.toDecimalPlaces(2),
    totalEgresos: totalEgresos.toDecimalPlaces(2),
    // Resultado del ejercicio = Σ(haber − debe) de toda cuenta de resultado (la
    // cascada). Es el valor contablemente correcto y el que cierra A = P + PN.
    // `totalIngresos − totalEgresos` NO sirve acá: las cuentas con naturaleza
    // opuesta a su categoría (deducciones 4.2 DEUDOR; ganancias financieras y
    // "otros ingresos" en clases 8/9, ACREEDOR) entran con signo invertido en
    // esa resta. (Los totales de los árboles se exhiben tal cual; el subledger
    // detallado puede no foot-ear al resultado cuando hay contra-cuentas.)
    resultado: rt9.resultadoEjercicio,
    rt9,
    difCambioNoRealizada: rev.total,
    tipoCambioCierre,
    fechaCotizacionCierre,
    advertencias,
  };
}

// NOTA: la UI usa la variante por fecha. La revaluación se computa acumulada
// hasta `periodo.fechaFin` (foto al cierre), mientras que el árbol por período
// agrega sólo los movimientos del período (sin saldo de apertura). Para una
// foto patrimonial usar la variante por fecha.
export async function getEstadoResultados(
  periodoId: number,
): Promise<EstadoResultadosResult | null> {
  const periodo = await db.periodoContable.findUnique({
    where: { id: periodoId },
    select: {
      id: true,
      codigo: true,
      nombre: true,
      fechaInicio: true,
      fechaFin: true,
    },
  });
  if (!periodo) return null;

  const cuerpo = await armarEstadoResultados({ periodoId }, periodo.fechaFin);
  return { periodo, ...cuerpo };
}

/** Estado de Resultados por rango de fechas (no requiere periodoId). */
export async function getEstadoResultadosByFecha(filter: {
  fechaDesde?: Date;
  fechaHasta?: Date;
}): Promise<Omit<EstadoResultadosResult, "periodo">> {
  const reportFilter: ReporteFilter = {
    fechaDesde: filter.fechaDesde,
    fechaHasta: filter.fechaHasta,
  };
  return armarEstadoResultados(reportFilter, filter.fechaHasta);
}
