import "server-only";

import { db } from "@/lib/db";
import { Decimal } from "@/lib/decimal";

import { buildCuentaTree, type CuentaTreeNode } from "./shared";

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
};

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

  const tree = await buildCuentaTree(["INGRESO", "EGRESO"], periodoId);

  const ingresos = tree.porCategoria.get("INGRESO") ?? [];
  const egresos = tree.porCategoria.get("EGRESO") ?? [];
  const totalIngresos =
    tree.totalPorCategoria.get("INGRESO") ?? new Decimal(0);
  const totalEgresos = tree.totalPorCategoria.get("EGRESO") ?? new Decimal(0);

  return {
    periodo,
    ingresos,
    egresos,
    totalIngresos: totalIngresos.toDecimalPlaces(2),
    totalEgresos: totalEgresos.toDecimalPlaces(2),
    resultado: totalIngresos.minus(totalEgresos).toDecimalPlaces(2),
  };
}
