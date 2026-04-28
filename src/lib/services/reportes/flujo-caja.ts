import "server-only";

import { db } from "@/lib/db";
import { Decimal, sumMoney, toDecimal } from "@/lib/decimal";
import {
  AsientoEstado,
  type CuentaCategoria,
  type CuentaTipo,
  type Moneda,
} from "@/generated/prisma/client";

import { listarMeses, mesKey, saldoPorCategoria } from "./shared";

export type FlujoOrigen = "REALIZADO" | "PROYECTADO";

export type FlujoCelula = {
  monto: Decimal;
  origen: FlujoOrigen;
};

/**
 * Nó de árvore para o flujo de caja. Cada nó representa uma cuenta del
 * plan de cuentas (SINTETICA o ANALITICA) com colunas mensales de monto.
 */
export type FlujoNode = {
  cuentaId: number;
  codigo: string;
  nombre: string;
  tipo: CuentaTipo;
  categoria: CuentaCategoria;
  nivel: number;
  valoresPorMes: Record<string, FlujoCelula>;
  totalPeriodo: Decimal;
  children: FlujoNode[];
};

export type FlujoCajaResult = {
  moneda: Moneda;
  desde: Date;
  hasta: Date;
  meses: string[];
  ingresos: FlujoNode[];
  egresos: FlujoNode[];
  totales: {
    totalIngresosPorMes: Record<string, Decimal>;
    totalEgresosPorMes: Record<string, Decimal>;
    saldoMensalPorMes: Record<string, Decimal>;
    saldoInicial: Decimal;
    saldoAcumuladoPorMes: Record<string, Decimal>;
  };
  advertencias: string[];
};

/**
 * Flujo de Caja iterando a árvore do plano de contas.
 *
 * Cada cuenta INGRESO o EGRESO genera uma fila; SINTETICAs agregam o
 * total de seus filhos. Colunas: meses do `desde` ao `hasta`.
 *
 * - Saldo inicial: soma de bancos+caja (cuentas 1.1.1.* y 1.1.2.*) com
 *   asiento.fecha < `desde` (acumulado anterior).
 * - Realizado: linhas con asiento.estado = CONTABILIZADO no rango.
 * - No incluye proyección (embarques/compras pendientes) nesta iteração;
 *   pode ser agregado depois marcando o `origen` como PROYECTADO.
 */
export async function getFlujoCaja(
  desde: Date,
  hasta: Date,
  moneda: Moneda,
): Promise<FlujoCajaResult> {
  const meses = listarMeses(desde, hasta);
  const advertencias: string[] = [];

  // 1) Cuentas relevantes + saldo inicial dos bancos
  const [cuentas, saldoInicialAgg] = await Promise.all([
    db.cuentaContable.findMany({
      where: { categoria: { in: ["INGRESO", "EGRESO"] } },
      orderBy: { codigo: "asc" },
      select: {
        id: true,
        codigo: true,
        nombre: true,
        tipo: true,
        categoria: true,
        nivel: true,
        padreCodigo: true,
      },
    }),
    db.lineaAsiento.aggregate({
      where: {
        asiento: {
          estado: AsientoEstado.CONTABILIZADO,
          fecha: { lt: desde },
          moneda,
        },
        cuenta: {
          OR: [
            { codigo: { startsWith: "1.1.1." } },
            { codigo: { startsWith: "1.1.2." } },
          ],
        },
      },
      _sum: { debe: true, haber: true },
    }),
  ]);

  const saldoInicial = toDecimal(saldoInicialAgg._sum.debe ?? 0)
    .minus(toDecimal(saldoInicialAgg._sum.haber ?? 0))
    .toDecimalPlaces(2);

  // 2) Lineas no range, agrupadas por (cuentaId, mes)
  const cuentaIds = cuentas.map((c) => c.id);
  if (cuentaIds.length === 0) {
    return emptyResult(moneda, desde, hasta, meses, saldoInicial);
  }

  const lineas = await db.lineaAsiento.findMany({
    where: {
      cuentaId: { in: cuentaIds },
      asiento: {
        estado: AsientoEstado.CONTABILIZADO,
        fecha: { gte: desde, lte: hasta },
        moneda,
      },
    },
    select: {
      cuentaId: true,
      debe: true,
      haber: true,
      asiento: { select: { fecha: true } },
    },
  });

  // 3) Agregação: cuentaId → mes → monto
  const cuentaMap = new Map(cuentas.map((c) => [c.id, c]));
  const agg = new Map<number, Map<string, Decimal>>();
  for (const l of lineas) {
    const cuenta = cuentaMap.get(l.cuentaId);
    if (!cuenta) continue;
    const mes = mesKey(l.asiento.fecha);
    const monto = saldoPorCategoria(
      toDecimal(l.debe),
      toDecimal(l.haber),
      cuenta.categoria,
    );
    let porMes = agg.get(l.cuentaId);
    if (!porMes) {
      porMes = new Map();
      agg.set(l.cuentaId, porMes);
    }
    porMes.set(mes, (porMes.get(mes) ?? new Decimal(0)).plus(monto));
  }

  // 4) Construir nodos (incluindo SINTETICAs com 0)
  const byCodigo = new Map<string, FlujoNode>();
  for (const c of cuentas) {
    const valoresPorMes: Record<string, FlujoCelula> = {};
    for (const m of meses) valoresPorMes[m] = celulaCero();
    if (c.tipo === "ANALITICA") {
      const porMes = agg.get(c.id);
      if (porMes) {
        for (const [mes, monto] of porMes.entries()) {
          if (valoresPorMes[mes]) {
            valoresPorMes[mes] = { monto, origen: "REALIZADO" };
          }
        }
      }
    }
    const totalPeriodo = sumMoney(
      Object.values(valoresPorMes).map((v) => v.monto),
    );
    byCodigo.set(c.codigo, {
      cuentaId: c.id,
      codigo: c.codigo,
      nombre: c.nombre,
      tipo: c.tipo,
      categoria: c.categoria,
      nivel: c.nivel,
      valoresPorMes,
      totalPeriodo,
      children: [],
    });
  }

  // 5) Linkar tree por padreCodigo
  const ingresosRoots: FlujoNode[] = [];
  const egresosRoots: FlujoNode[] = [];
  for (const c of cuentas) {
    const node = byCodigo.get(c.codigo)!;
    if (c.padreCodigo) {
      const parent = byCodigo.get(c.padreCodigo);
      if (parent) {
        parent.children.push(node);
        continue;
      }
    }
    if (node.categoria === "INGRESO") ingresosRoots.push(node);
    else if (node.categoria === "EGRESO") egresosRoots.push(node);
  }

  // 6) Roll-up bottom-up nas SINTETICAs
  const rollUp = (node: FlujoNode): void => {
    if (node.tipo === "SINTETICA" && node.children.length > 0) {
      for (const ch of node.children) rollUp(ch);
      for (const m of meses) {
        const sumChildren = node.children.reduce(
          (acc, ch) => acc.plus(ch.valoresPorMes[m]?.monto ?? new Decimal(0)),
          new Decimal(0),
        );
        node.valoresPorMes[m] = {
          monto: sumChildren.toDecimalPlaces(2),
          origen: "REALIZADO",
        };
      }
      node.totalPeriodo = sumMoney(
        node.children.map((ch) => ch.totalPeriodo),
      );
    } else {
      node.totalPeriodo = node.totalPeriodo.toDecimalPlaces(2);
    }
  };
  for (const r of ingresosRoots) rollUp(r);
  for (const r of egresosRoots) rollUp(r);

  // 7) Totales por mes
  const totalIngresosPorMes: Record<string, Decimal> = {};
  const totalEgresosPorMes: Record<string, Decimal> = {};
  const saldoMensalPorMes: Record<string, Decimal> = {};
  const saldoAcumuladoPorMes: Record<string, Decimal> = {};

  let acum = saldoInicial;
  for (const m of meses) {
    const totalIn = sumMoney(
      ingresosRoots.map((r) => r.valoresPorMes[m]?.monto ?? new Decimal(0)),
    );
    const totalEg = sumMoney(
      egresosRoots.map((r) => r.valoresPorMes[m]?.monto ?? new Decimal(0)),
    );
    totalIngresosPorMes[m] = totalIn;
    totalEgresosPorMes[m] = totalEg;
    const saldo = totalIn.minus(totalEg);
    saldoMensalPorMes[m] = saldo;
    acum = acum.plus(saldo);
    saldoAcumuladoPorMes[m] = acum;
  }

  return {
    moneda,
    desde,
    hasta,
    meses,
    ingresos: ingresosRoots,
    egresos: egresosRoots,
    totales: {
      totalIngresosPorMes,
      totalEgresosPorMes,
      saldoMensalPorMes,
      saldoInicial,
      saldoAcumuladoPorMes,
    },
    advertencias,
  };
}

function celulaCero(): FlujoCelula {
  return { monto: new Decimal(0), origen: "REALIZADO" };
}

function emptyResult(
  moneda: Moneda,
  desde: Date,
  hasta: Date,
  meses: string[],
  saldoInicial: Decimal,
): FlujoCajaResult {
  const cero = (): Record<string, Decimal> => {
    const r: Record<string, Decimal> = {};
    for (const m of meses) r[m] = new Decimal(0);
    return r;
  };
  const acum = (): Record<string, Decimal> => {
    const r: Record<string, Decimal> = {};
    let s = saldoInicial;
    for (const m of meses) r[m] = s;
    return r;
  };
  return {
    moneda,
    desde,
    hasta,
    meses,
    ingresos: [],
    egresos: [],
    totales: {
      totalIngresosPorMes: cero(),
      totalEgresosPorMes: cero(),
      saldoMensalPorMes: cero(),
      saldoInicial,
      saldoAcumuladoPorMes: acum(),
    },
    advertencias: [],
  };
}
