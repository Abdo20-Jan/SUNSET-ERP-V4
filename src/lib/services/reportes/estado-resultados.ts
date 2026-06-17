import "server-only";

import { db } from "@/lib/db";
import { Decimal, toDecimal } from "@/lib/decimal";
import { AsientoEstado } from "@/generated/prisma/client";

import {
  construirEstadoResultadosRT9,
  type EstadoResultadosRT9,
  type LeafResultado,
} from "./estado-resultados-rt9";
import { buildCuentaTree, type CuentaTreeNode, type ReporteFilter } from "./shared";

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
};

/**
 * Agrega las cuentas analíticas de resultado (INGRESO/EGRESO) por el mismo
 * filtro temporal del reporte y arma la cascada RT9. Usa el `rubroEECC` de
 * cada cuenta (manda sobre el código) para clasificar la sección.
 */
async function buildEstadoResultadosRT9(filter: ReporteFilter): Promise<EstadoResultadosRT9> {
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

  return construirEstadoResultadosRT9(leaves);
}

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

  const [tree, rt9] = await Promise.all([
    buildCuentaTree(["INGRESO", "EGRESO"], { periodoId }),
    buildEstadoResultadosRT9({ periodoId }),
  ]);

  const ingresos = tree.porCategoria.get("INGRESO") ?? [];
  const egresos = tree.porCategoria.get("EGRESO") ?? [];
  const totalIngresos = tree.totalPorCategoria.get("INGRESO") ?? new Decimal(0);
  const totalEgresos = tree.totalPorCategoria.get("EGRESO") ?? new Decimal(0);

  return {
    periodo,
    ingresos,
    egresos,
    totalIngresos: totalIngresos.toDecimalPlaces(2),
    totalEgresos: totalEgresos.toDecimalPlaces(2),
    resultado: totalIngresos.minus(totalEgresos).toDecimalPlaces(2),
    rt9,
  };
}

/** Estado de Resultados por rango de fechas (no requiere periodoId). */
export async function getEstadoResultadosByFecha(filter: {
  fechaDesde?: Date;
  fechaHasta?: Date;
}): Promise<{
  ingresos: CuentaTreeNode[];
  egresos: CuentaTreeNode[];
  totalIngresos: Decimal;
  totalEgresos: Decimal;
  resultado: Decimal;
  rt9: EstadoResultadosRT9;
}> {
  const reportFilter: ReporteFilter = {
    fechaDesde: filter.fechaDesde,
    fechaHasta: filter.fechaHasta,
  };
  const [tree, rt9] = await Promise.all([
    buildCuentaTree(["INGRESO", "EGRESO"], reportFilter),
    buildEstadoResultadosRT9(reportFilter),
  ]);

  const ingresos = tree.porCategoria.get("INGRESO") ?? [];
  const egresos = tree.porCategoria.get("EGRESO") ?? [];
  const totalIngresos = tree.totalPorCategoria.get("INGRESO") ?? new Decimal(0);
  const totalEgresos = tree.totalPorCategoria.get("EGRESO") ?? new Decimal(0);

  return {
    ingresos,
    egresos,
    totalIngresos: totalIngresos.toDecimalPlaces(2),
    totalEgresos: totalEgresos.toDecimalPlaces(2),
    resultado: totalIngresos.minus(totalEgresos).toDecimalPlaces(2),
    rt9,
  };
}
