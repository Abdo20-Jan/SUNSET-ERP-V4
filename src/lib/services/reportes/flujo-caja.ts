import "server-only";

import { db } from "@/lib/db";
import { Decimal, sumMoney, toDecimal } from "@/lib/decimal";
import {
  AsientoEstado,
  type CuentaCategoria,
  type CuentaTipo,
  type Moneda,
} from "@/generated/prisma/client";

import { listarMeses, mesKey } from "./shared";

export type FlujoOrigen = "REALIZADO" | "PROYECTADO";

export type FlujoCelula = {
  monto: Decimal;
  origen: FlujoOrigen;
};

/**
 * Nó de árvore para o flujo de caja. Cada nó representa uma cuenta del
 * plan de cuentas (SINTETICA o ANALITICA) con cashflow mensal signado:
 *   - Positivo: entrada de cash al banco/caja (la cuenta fue HABER del
 *     asiento — ej. cliente cobrado, préstamo recibido, ingreso operativo)
 *   - Negativo: salida de cash (la cuenta fue DEBE — ej. proveedor pagado,
 *     gasto, percepción fiscal, pago préstamo)
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
  // Cuentas que recibieron flujo de caja en el período, organizadas por
  // su rama natural del plan de cuentas (ACTIVO/PASIVO/PATRIMONIO/INGRESO/
  // EGRESO). Excluye 1.1.1.* y 1.1.2.* (bancos/cajas) — esas son la
  // contrapartida del flujo, no su clasificación.
  contrapartidas: FlujoNode[];
  // Asientos puros de transferencia entre cuentas propias (≥2 líneas en
  // banco/caja, 0 contrapartidas externas). Cada banco aparece con su
  // movimiento neto signado. Total por mes = 0 por construcción.
  transferencias: FlujoNode[];
  totales: {
    totalIngresosPorMes: Record<string, Decimal>;
    totalEgresosPorMes: Record<string, Decimal>;
    saldoMensalPorMes: Record<string, Decimal>;
    saldoInicial: Decimal;
    saldoAcumuladoPorMes: Record<string, Decimal>;
  };
  advertencias: string[];
};

const BANCO_CAJA_PREFIXES = ["1.1.1.", "1.1.2."];

function esBancoCaja(codigo: string): boolean {
  return BANCO_CAJA_PREFIXES.some((p) => codigo.startsWith(p));
}

/**
 * Flujo de Caja real: itera todos los movimientos que tocan banco/caja
 * y atribuye el flujo a cada cuenta contrapartida (proveedor, cliente,
 * préstamo, impuesto, gasto, crédito fiscal, capital, etc.).
 *
 * Por construcción: Σ flujo contrapartidas = (saldo final bancos) −
 * (saldo inicial bancos). Bate con extracto bancario.
 *
 * Sign convention por cuenta:
 *   cashFlow = línea.haber − línea.debe
 *   - HABER (cuenta acreditada) → cash llegó al banco a través de esta
 *     cuenta → flujo positivo (ingreso)
 *   - DEBE  (cuenta debitada) → cash salió del banco hacia esta cuenta
 *     → flujo negativo (egreso)
 */
export async function getFlujoCaja(
  desde: Date,
  hasta: Date,
  moneda: Moneda,
): Promise<FlujoCajaResult> {
  const meses = listarMeses(desde, hasta);
  const advertencias: string[] = [];

  // 1) Saldo inicial: suma debe − haber de bancos+caja con asientos antes
  //    del rango (acumulado neto que bancos tenían al iniciar `desde`).
  const saldoInicialAgg = await db.lineaAsiento.aggregate({
    where: {
      asiento: {
        estado: AsientoEstado.CONTABILIZADO,
        fecha: { lt: desde },
        moneda,
      },
      cuenta: {
        OR: BANCO_CAJA_PREFIXES.map((p) => ({ codigo: { startsWith: p } })),
      },
    },
    _sum: { debe: true, haber: true },
  });
  const saldoInicial = toDecimal(saldoInicialAgg._sum.debe ?? 0)
    .minus(toDecimal(saldoInicialAgg._sum.haber ?? 0))
    .toDecimalPlaces(2);

  // 2) Cargar todos los asientos del período que tocan banco/caja, con
  //    sus líneas y los códigos de cuenta de cada línea.
  const asientos = await db.asiento.findMany({
    where: {
      estado: AsientoEstado.CONTABILIZADO,
      fecha: { gte: desde, lte: hasta },
      moneda,
      lineas: {
        some: {
          cuenta: {
            OR: BANCO_CAJA_PREFIXES.map((p) => ({
              codigo: { startsWith: p },
            })),
          },
        },
      },
    },
    select: {
      id: true,
      fecha: true,
      lineas: {
        select: {
          cuentaId: true,
          debe: true,
          haber: true,
          cuenta: { select: { codigo: true } },
        },
      },
    },
  });

  // 3) Atribuir flujo a cada cuenta contrapartida (no banco/caja).
  //    Pure transfers (≥2 banco lines, 0 non-banco) → tabla aparte.
  const flujoPorCuenta = new Map<number, Map<string, Decimal>>();
  const transferenciasPorBanco = new Map<number, Map<string, Decimal>>();

  for (const a of asientos) {
    const mes = mesKey(a.fecha);
    const bancoLines = a.lineas.filter((l) => esBancoCaja(l.cuenta.codigo));
    const otrasLines = a.lineas.filter((l) => !esBancoCaja(l.cuenta.codigo));

    if (otrasLines.length === 0 && bancoLines.length >= 2) {
      // Transferencia entre cuentas propias.
      for (const b of bancoLines) {
        const flow = toDecimal(b.debe).minus(toDecimal(b.haber));
        if (flow.abs().lt(0.01)) continue;
        let porMes = transferenciasPorBanco.get(b.cuentaId);
        if (!porMes) {
          porMes = new Map();
          transferenciasPorBanco.set(b.cuentaId, porMes);
        }
        porMes.set(mes, (porMes.get(mes) ?? new Decimal(0)).plus(flow));
      }
      continue;
    }

    for (const l of otrasLines) {
      const flow = toDecimal(l.haber).minus(toDecimal(l.debe));
      if (flow.abs().lt(0.01)) continue;
      let porMes = flujoPorCuenta.get(l.cuentaId);
      if (!porMes) {
        porMes = new Map();
        flujoPorCuenta.set(l.cuentaId, porMes);
      }
      porMes.set(mes, (porMes.get(mes) ?? new Decimal(0)).plus(flow));
    }
  }

  // 4) Cargar info de las cuentas contrapartida + sus ancestros para
  //    poder armar el árbol completo.
  const cuentaIdsConFlujo = Array.from(flujoPorCuenta.keys());
  const bancoIdsTransfer = Array.from(transferenciasPorBanco.keys());

  const [cuentasFlujo, bancosTransfer] = await Promise.all([
    cuentaIdsConFlujo.length > 0
      ? db.cuentaContable.findMany({
          where: { id: { in: cuentaIdsConFlujo } },
          select: {
            id: true,
            codigo: true,
            nombre: true,
            tipo: true,
            categoria: true,
            nivel: true,
            padreCodigo: true,
          },
        })
      : Promise.resolve([]),
    bancoIdsTransfer.length > 0
      ? db.cuentaContable.findMany({
          where: { id: { in: bancoIdsTransfer } },
          select: {
            id: true,
            codigo: true,
            nombre: true,
            tipo: true,
            categoria: true,
            nivel: true,
            padreCodigo: true,
          },
        })
      : Promise.resolve([]),
  ]);

  // Cargar todos los ancestros (sintéticas) hasta el root.
  const codigosAncestros = new Set<string>();
  for (const c of cuentasFlujo) {
    let codigo: string | null = c.padreCodigo;
    while (codigo) {
      if (codigosAncestros.has(codigo)) break;
      codigosAncestros.add(codigo);
      const padre = codigo.lastIndexOf(".");
      codigo = padre === -1 ? null : codigo.slice(0, padre);
    }
  }

  const ancestros =
    codigosAncestros.size > 0
      ? await db.cuentaContable.findMany({
          where: { codigo: { in: Array.from(codigosAncestros) } },
          select: {
            id: true,
            codigo: true,
            nombre: true,
            tipo: true,
            categoria: true,
            nivel: true,
            padreCodigo: true,
          },
        })
      : [];

  // 5) Construir tree (cuentas contrapartida).
  const todasCuentasFlujo = [...cuentasFlujo, ...ancestros].sort((a, b) =>
    a.codigo.localeCompare(b.codigo),
  );
  const byCodigo = new Map<string, FlujoNode>();
  for (const c of todasCuentasFlujo) {
    const valoresPorMes: Record<string, FlujoCelula> = {};
    for (const m of meses) valoresPorMes[m] = celulaCero();
    if (c.tipo === "ANALITICA") {
      const porMes = flujoPorCuenta.get(c.id);
      if (porMes) {
        for (const [mes, monto] of porMes.entries()) {
          if (valoresPorMes[mes]) {
            valoresPorMes[mes] = {
              monto: monto.toDecimalPlaces(2),
              origen: "REALIZADO",
            };
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

  const contrapartidasRoots: FlujoNode[] = [];
  for (const c of todasCuentasFlujo) {
    const node = byCodigo.get(c.codigo)!;
    if (c.padreCodigo) {
      const parent = byCodigo.get(c.padreCodigo);
      if (parent) {
        parent.children.push(node);
        continue;
      }
    }
    contrapartidasRoots.push(node);
  }

  // Roll-up bottom-up
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
  for (const r of contrapartidasRoots) rollUp(r);

  // Ordenar roots por código (1, 2, 3, 4, 5)
  contrapartidasRoots.sort((a, b) => a.codigo.localeCompare(b.codigo));

  // 6) Tree de transferencias (bancos involucrados en pure transfers)
  const transferenciasNodes: FlujoNode[] = bancosTransfer.map((c) => {
    const valoresPorMes: Record<string, FlujoCelula> = {};
    for (const m of meses) valoresPorMes[m] = celulaCero();
    const porMes = transferenciasPorBanco.get(c.id);
    if (porMes) {
      for (const [mes, monto] of porMes.entries()) {
        if (valoresPorMes[mes]) {
          valoresPorMes[mes] = {
            monto: monto.toDecimalPlaces(2),
            origen: "REALIZADO",
          };
        }
      }
    }
    const totalPeriodo = sumMoney(
      Object.values(valoresPorMes).map((v) => v.monto),
    );
    return {
      cuentaId: c.id,
      codigo: c.codigo,
      nombre: c.nombre,
      tipo: c.tipo,
      categoria: c.categoria,
      nivel: c.nivel,
      valoresPorMes,
      totalPeriodo,
      children: [],
    };
  });

  // 7) Totales por mes:
  //    - Ingresos: suma de cashflows positivos en contrapartidas (cash que
  //      llegó al banco)
  //    - Egresos: suma de cashflows negativos en contrapartidas (cash que
  //      salió del banco)
  //    - Saldo del mes = ingresos + egresos (egresos ya negativo)
  const totalIngresosPorMes: Record<string, Decimal> = {};
  const totalEgresosPorMes: Record<string, Decimal> = {};
  const saldoMensalPorMes: Record<string, Decimal> = {};
  const saldoAcumuladoPorMes: Record<string, Decimal> = {};

  // Walk all ANALITICAs (nodes sin children) en contrapartidas
  const analiticas: FlujoNode[] = [];
  const collectAnaliticas = (n: FlujoNode) => {
    if (n.tipo === "ANALITICA") analiticas.push(n);
    n.children.forEach(collectAnaliticas);
  };
  for (const r of contrapartidasRoots) collectAnaliticas(r);

  let acum = saldoInicial;
  for (const m of meses) {
    let ingresos = new Decimal(0);
    let egresos = new Decimal(0);
    for (const a of analiticas) {
      const v = a.valoresPorMes[m]?.monto ?? new Decimal(0);
      if (v.gt(0)) ingresos = ingresos.plus(v);
      else if (v.lt(0)) egresos = egresos.plus(v); // egresos negativo
    }
    totalIngresosPorMes[m] = ingresos.toDecimalPlaces(2);
    totalEgresosPorMes[m] = egresos.toDecimalPlaces(2);
    const saldo = ingresos.plus(egresos);
    saldoMensalPorMes[m] = saldo.toDecimalPlaces(2);
    acum = acum.plus(saldo);
    saldoAcumuladoPorMes[m] = acum.toDecimalPlaces(2);
  }

  return {
    moneda,
    desde,
    hasta,
    meses,
    contrapartidas: contrapartidasRoots,
    transferencias: transferenciasNodes,
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
