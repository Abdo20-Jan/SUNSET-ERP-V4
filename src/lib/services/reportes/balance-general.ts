import "server-only";

import { db } from "@/lib/db";
import { Decimal, eqMoney, sumMoney } from "@/lib/decimal";

import {
  getEstadoResultados,
  getEstadoResultadosByFecha,
} from "./estado-resultados";
import { buildCuentaTree, type CuentaTreeNode } from "./shared";

export type BalanceGeneralContexto =
  | {
      tipo: "periodo";
      periodoId: number;
      codigo: string;
      nombre: string;
      fechaInicio: Date;
      fechaFin: Date;
    }
  | {
      tipo: "fecha";
      fechaDesde: Date | null;
      fechaHasta: Date | null;
    };

export type BalanceGeneralResult = {
  // periodo se mantiene para compat con páginas existentes; cuando el
  // filtro es por fecha, se llena con valores sintéticos.
  periodo: {
    id: number;
    codigo: string;
    nombre: string;
    fechaInicio: Date;
    fechaFin: Date;
  };
  contexto: BalanceGeneralContexto;
  activo: CuentaTreeNode[];
  pasivo: CuentaTreeNode[];
  patrimonio: CuentaTreeNode[];
  totalActivo: Decimal;
  totalPasivo: Decimal;
  totalPatrimonio: Decimal;
  totalSaldoInicialActivo: Decimal;
  totalSaldoInicialPasivo: Decimal;
  totalSaldoInicialPatrimonio: Decimal;
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
    buildCuentaTree(["ACTIVO", "PASIVO", "PATRIMONIO"], { periodoId }),
    getEstadoResultados(periodoId),
  ]);

  return ensamblar({
    periodo,
    contexto: {
      tipo: "periodo",
      periodoId: periodo.id,
      codigo: periodo.codigo,
      nombre: periodo.nombre,
      fechaInicio: periodo.fechaInicio,
      fechaFin: periodo.fechaFin,
    },
    tree,
    resultadoEjercicio: estado?.resultado ?? new Decimal(0),
  });
}

export async function getBalanceGeneralByFecha(filter: {
  fechaDesde?: Date;
  fechaHasta?: Date;
}): Promise<BalanceGeneralResult> {
  const [tree, estado] = await Promise.all([
    buildCuentaTree(["ACTIVO", "PASIVO", "PATRIMONIO"], filter),
    getEstadoResultadosByFecha(filter),
  ]);

  return ensamblar({
    periodo: {
      id: 0,
      codigo: "—",
      nombre: rangoLabel(filter.fechaDesde, filter.fechaHasta),
      fechaInicio: filter.fechaDesde ?? new Date(0),
      fechaFin: filter.fechaHasta ?? new Date(),
    },
    contexto: {
      tipo: "fecha",
      fechaDesde: filter.fechaDesde ?? null,
      fechaHasta: filter.fechaHasta ?? null,
    },
    tree,
    resultadoEjercicio: estado.resultado,
  });
}

function ensamblar({
  periodo,
  contexto,
  tree,
  resultadoEjercicio,
}: {
  periodo: BalanceGeneralResult["periodo"];
  contexto: BalanceGeneralContexto;
  tree: Awaited<ReturnType<typeof buildCuentaTree>>;
  resultadoEjercicio: Decimal;
}): BalanceGeneralResult {
  const activo = tree.porCategoria.get("ACTIVO") ?? [];
  const pasivo = tree.porCategoria.get("PASIVO") ?? [];
  const patrimonio = tree.porCategoria.get("PATRIMONIO") ?? [];

  const totalActivo = tree.totalPorCategoria.get("ACTIVO") ?? new Decimal(0);
  const totalPasivo = tree.totalPorCategoria.get("PASIVO") ?? new Decimal(0);
  const totalPatrimonio =
    tree.totalPorCategoria.get("PATRIMONIO") ?? new Decimal(0);

  const totalSaldoInicialActivo = sumMoney(
    activo.map((n) => n.saldoInicial),
  );
  const totalSaldoInicialPasivo = sumMoney(
    pasivo.map((n) => n.saldoInicial),
  );
  const totalSaldoInicialPatrimonio = sumMoney(
    patrimonio.map((n) => n.saldoInicial),
  );

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
    contexto,
    activo,
    pasivo,
    patrimonio,
    totalActivo: totalActivo.toDecimalPlaces(2),
    totalPasivo: totalPasivo.toDecimalPlaces(2),
    totalPatrimonio: totalPatrimonio.toDecimalPlaces(2),
    totalSaldoInicialActivo: totalSaldoInicialActivo.toDecimalPlaces(2),
    totalSaldoInicialPasivo: totalSaldoInicialPasivo.toDecimalPlaces(2),
    totalSaldoInicialPatrimonio: totalSaldoInicialPatrimonio.toDecimalPlaces(2),
    resultadoEjercicio,
    totalPatrimonioAjustado: totalPatrimonioAjustado.toDecimalPlaces(2),
    cuadra: eqMoney(totalActivo, somaPasivoPatrimonio),
    diferencia,
  };
}

function rangoLabel(desde: Date | undefined, hasta: Date | undefined): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  if (desde && hasta) return `Del ${fmt(desde)} al ${fmt(hasta)}`;
  if (hasta) return `Saldo al ${fmt(hasta)}`;
  if (desde) return `Desde ${fmt(desde)}`;
  return "Histórico completo";
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
