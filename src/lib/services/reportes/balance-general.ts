import "server-only";

import { db } from "@/lib/db";
import { Decimal, eqMoney } from "@/lib/decimal";

import { getEstadoResultados } from "./estado-resultados";
import { buildCuentaTree, type CuentaTreeNode } from "./shared";

export type BalanceGeneralResult = {
  periodo: {
    id: number;
    codigo: string;
    nombre: string;
    fechaInicio: Date;
    fechaFin: Date;
  };
  activo: CuentaTreeNode[];
  pasivo: CuentaTreeNode[];
  patrimonio: CuentaTreeNode[];
  totalActivo: Decimal;
  totalPasivo: Decimal;
  totalPatrimonio: Decimal;
  resultadoEjercicio: Decimal;
  totalPatrimonioAjustado: Decimal;
  cuadra: boolean;
  diferencia: Decimal;
};

// Código da conta analítica "RESULTADO DEL EJERCICIO" no plano oficial.
const CODIGO_RESULTADO_EJERCICIO = "3.2.1.02";

export async function getBalanceGeneral(
  periodoId: number,
): Promise<BalanceGeneralResult | null> {
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

  const [tree, estado] = await Promise.all([
    buildCuentaTree(["ACTIVO", "PASIVO", "PATRIMONIO"], periodoId),
    getEstadoResultados(periodoId),
  ]);

  const activo = tree.porCategoria.get("ACTIVO") ?? [];
  const pasivo = tree.porCategoria.get("PASIVO") ?? [];
  const patrimonio = tree.porCategoria.get("PATRIMONIO") ?? [];

  const totalActivo = tree.totalPorCategoria.get("ACTIVO") ?? new Decimal(0);
  const totalPasivo = tree.totalPorCategoria.get("PASIVO") ?? new Decimal(0);
  const totalPatrimonio =
    tree.totalPorCategoria.get("PATRIMONIO") ?? new Decimal(0);

  const resultadoEjercicio = estado?.resultado ?? new Decimal(0);

  // Se já existir conta "3.2.1.02 RESULTADO DEL EJERCICIO" com saldo no período,
  // o saldo dela já está em `totalPatrimonio`. Senão, injetamos o resultado
  // calculado (Ingresos - Egresos) para fechar a equação contábil.
  const cuentaResultadoYaMovida = patrimonio.some((root) =>
    containsCuentaComSaldo(root, CODIGO_RESULTADO_EJERCICIO),
  );
  const totalPatrimonioAjustado = cuentaResultadoYaMovida
    ? totalPatrimonio
    : totalPatrimonio.plus(resultadoEjercicio);

  const somaPasivoPatrimonio = totalPasivo.plus(totalPatrimonioAjustado);
  const diferencia = totalActivo
    .minus(somaPasivoPatrimonio)
    .toDecimalPlaces(2);

  return {
    periodo,
    activo,
    pasivo,
    patrimonio,
    totalActivo: totalActivo.toDecimalPlaces(2),
    totalPasivo: totalPasivo.toDecimalPlaces(2),
    totalPatrimonio: totalPatrimonio.toDecimalPlaces(2),
    resultadoEjercicio,
    totalPatrimonioAjustado: totalPatrimonioAjustado.toDecimalPlaces(2),
    cuadra: eqMoney(totalActivo, somaPasivoPatrimonio),
    diferencia,
  };
}

function containsCuentaComSaldo(
  node: CuentaTreeNode,
  codigo: string,
): boolean {
  if (node.codigo === codigo && !node.saldo.isZero()) return true;
  for (const ch of node.children) {
    if (containsCuentaComSaldo(ch, codigo)) return true;
  }
  return false;
}
