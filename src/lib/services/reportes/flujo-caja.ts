import "server-only";

import { db } from "@/lib/db";
import { Decimal, sumMoney, toDecimal } from "@/lib/decimal";
import { getCuentasBancoCajaConMoneda } from "@/lib/services/cuenta-bancaria";
import { PREFIJOS_BANCO_CAJA } from "@/lib/services/prefijos-plan";
import {
  AsientoEstado,
  type CuentaCategoria,
  type CuentaTipo,
  Moneda,
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
  // contrapartida del flujo, no su clasificación. Es el DETALLE cualitativo;
  // los totales se calculan sobre el lado banco (ver totales).
  contrapartidas: FlujoNode[];
  // Asientos puros de transferencia entre cuentas propias (≥2 líneas en
  // banco/caja, 0 contrapartidas externas). Cada banco aparece con su
  // movimiento neto signado. En una transferencia de la MISMA moneda el total
  // por mes es 0 (las piernas se cancelan); en una transferencia cross-moneda
  // sólo aparece la pierna de la moneda del reporte (compra/venta de divisa).
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

const BANCO_CAJA_PREFIXES = PREFIJOS_BANCO_CAJA;

function esBancoCaja(codigo: string): boolean {
  return BANCO_CAJA_PREFIXES.some((p) => codigo.startsWith(p));
}

type LineaMoneda = {
  debe: Decimal;
  haber: Decimal;
  monedaOrigen: Moneda | null;
  montoOrigen: Decimal | null;
};

/**
 * Valor de una línea EN LA MONEDA `M` del reporte, como par `{debeM, haberM}`
 * de MAGNITUDES no-negativas (el signo se deriva luego de `debeM − haberM`).
 * Espelha `calcularSaldosCuentasBancariasEnMonedaCuenta`:
 *   - M=ARS: `debe`/`haber` crudos (el ledger es en pesos).
 *   - M=USD con `monedaOrigen=USD`: el lado con valor toma `montoOrigen` (el
 *     principal USD invariante a TC); el otro lado queda en 0.
 *   - M=USD legado (`monedaOrigen=null` y `asiento.moneda=USD`): `debe`/`haber`
 *     crudos, que en ese caso ya estaban grabados en USD.
 *   - resto (línea ARS bajo un reporte USD): `{0,0}` → fuera del flujo USD,
 *     no hay TC para inferir el principal.
 */
function valorEnMoneda(
  linea: LineaMoneda,
  M: Moneda,
  asientoMoneda: Moneda,
): { debeM: Decimal; haberM: Decimal } {
  if (M === Moneda.ARS) {
    return { debeM: linea.debe, haberM: linea.haber };
  }
  if (linea.monedaOrigen === Moneda.USD) {
    const usd = linea.montoOrigen ?? new Decimal(0);
    return {
      debeM: linea.debe.gt(0) ? usd : new Decimal(0),
      haberM: linea.haber.gt(0) ? usd : new Decimal(0),
    };
  }
  if (linea.monedaOrigen === null && asientoMoneda === Moneda.USD) {
    return { debeM: linea.debe, haberM: linea.haber };
  }
  return { debeM: new Decimal(0), haberM: new Decimal(0) };
}

/**
 * Flujo de Caja real: itera los asientos que tocan alguna cuenta banco/caja
 * DE LA MONEDA `moneda` (la moneda de la cuenta, derivada de la CuentaBancaria
 * ligada — NO `asiento.moneda`, que es la cabeza del asiento y siempre es ARS
 * desde E3). El valor de cada línea se toma en la moneda del reporte vía
 * `valorEnMoneda` (montoOrigen para USD). El flujo se atribuye a cada cuenta
 * contrapartida para el DETALLE, pero los totales/saldo se calculan sobre el
 * LADO BANCO para que cuadren con `calcularSaldosCuentasBancariasEnMonedaCuenta`
 * por moneda incluso con asientos cross-moneda (pago exterior, compra divisa).
 *
 * Sign convention por cuenta contrapartida:
 *   cashFlow = haberM − debeM (HABER → cash entró; DEBE → cash salió).
 */
export async function getFlujoCaja(
  desde: Date,
  hasta: Date,
  moneda: Moneda,
): Promise<FlujoCajaResult> {
  const meses = listarMeses(desde, hasta);
  const advertencias: string[] = [];

  // Cuentas banco/caja de la moneda pedida (fuente única compartida con
  // getSaldosBancarios → particiona por CuentaBancaria.moneda, igual a la
  // función-âncora del invariante de aceitação).
  const cuentasBC = await getCuentasBancoCajaConMoneda();
  const bancoCajaIdsM = new Set(
    cuentasBC.filter((c) => c.moneda === moneda).map((c) => c.cuentaContableId),
  );

  const totalesVacios = (): FlujoCajaResult["totales"] => {
    const ceros: Record<string, Decimal> = {};
    for (const m of meses) ceros[m] = new Decimal(0);
    return {
      totalIngresosPorMes: { ...ceros },
      totalEgresosPorMes: { ...ceros },
      saldoMensalPorMes: { ...ceros },
      saldoInicial: new Decimal(0),
      saldoAcumuladoPorMes: { ...ceros },
    };
  };

  if (bancoCajaIdsM.size === 0) {
    advertencias.push(`No hay cuentas de banco/caja en ${moneda}.`);
    return {
      moneda,
      desde,
      hasta,
      meses,
      contrapartidas: [],
      transferencias: [],
      totales: totalesVacios(),
      advertencias,
    };
  }

  const bancoCajaIdArray = Array.from(bancoCajaIdsM);

  // 1) Saldo inicial: líneas de las cuentas banco/caja de la moneda con
  //    asientos contabilizados ANTES de `desde`. Vía findMany (no aggregate)
  //    porque USD necesita montoOrigen línea a línea.
  const lineasIniciales = await db.lineaAsiento.findMany({
    where: {
      cuentaId: { in: bancoCajaIdArray },
      asiento: { estado: AsientoEstado.CONTABILIZADO, fecha: { lt: desde } },
    },
    select: {
      debe: true,
      haber: true,
      monedaOrigen: true,
      montoOrigen: true,
      asiento: { select: { moneda: true } },
    },
  });
  let saldoInicial = new Decimal(0);
  for (const l of lineasIniciales) {
    const { debeM, haberM } = valorEnMoneda(
      {
        debe: toDecimal(l.debe),
        haber: toDecimal(l.haber),
        monedaOrigen: l.monedaOrigen,
        montoOrigen: l.montoOrigen != null ? toDecimal(l.montoOrigen) : null,
      },
      moneda,
      l.asiento.moneda,
    );
    saldoInicial = saldoInicial.plus(debeM).minus(haberM);
  }
  saldoInicial = saldoInicial.toDecimalPlaces(2);

  // 2) Asientos del período que tocan ALGUNA cuenta banco/caja de la moneda.
  const asientos = await db.asiento.findMany({
    where: {
      estado: AsientoEstado.CONTABILIZADO,
      fecha: { gte: desde, lte: hasta },
      lineas: { some: { cuentaId: { in: bancoCajaIdArray } } },
    },
    select: {
      id: true,
      fecha: true,
      moneda: true,
      lineas: {
        select: {
          cuentaId: true,
          debe: true,
          haber: true,
          monedaOrigen: true,
          montoOrigen: true,
          cuenta: { select: { codigo: true } },
        },
      },
    },
  });

  // 3) Atribuir flujo. El DETALLE (árbol) sale de las contrapartidas; los
  //    TOTALES/saldo salen del lado banco (cuentaId ∈ bancoCajaIdsM) en la
  //    moneda del reporte — eso es lo que cuadra con la âncora.
  const flujoPorCuenta = new Map<number, Map<string, Decimal>>();
  const transferenciasPorBanco = new Map<number, Map<string, Decimal>>();
  const ingresosBancoPorMes = new Map<string, Decimal>();
  const egresosBancoPorMes = new Map<string, Decimal>();
  const contrapartidaNetaPorMes = new Map<string, Decimal>();

  for (const a of asientos) {
    const mes = mesKey(a.fecha);
    const lineasM = a.lineas.map((l) => {
      const { debeM, haberM } = valorEnMoneda(
        {
          debe: toDecimal(l.debe),
          haber: toDecimal(l.haber),
          monedaOrigen: l.monedaOrigen,
          montoOrigen: l.montoOrigen != null ? toDecimal(l.montoOrigen) : null,
        },
        moneda,
        a.moneda,
      );
      return { cuentaId: l.cuentaId, codigo: l.cuenta.codigo, debeM, haberM };
    });

    // Lado banco (base del invariante): Δ = debeM − haberM de las líneas cuyo
    // cuentaId está en las cuentas banco/caja de la moneda.
    for (const l of lineasM) {
      if (!bancoCajaIdsM.has(l.cuentaId)) continue;
      const delta = l.debeM.minus(l.haberM);
      // Mismo umbral sub-centavo que el lado contrapartida, para no contar un
      // delta que la contrapartida descartaría (evita advertencias espurias).
      if (delta.abs().lt(0.01)) continue;
      if (delta.gt(0)) {
        ingresosBancoPorMes.set(mes, (ingresosBancoPorMes.get(mes) ?? new Decimal(0)).plus(delta));
      } else {
        egresosBancoPorMes.set(mes, (egresosBancoPorMes.get(mes) ?? new Decimal(0)).plus(delta));
      }
    }

    // Detalle: clasificar banco-vs-contrapartida por CÓDIGO (cualquier moneda,
    // para seguir detectando transferencias cross-moneda como tales).
    const bancoLines = lineasM.filter((l) => esBancoCaja(l.codigo));
    const otrasLines = lineasM.filter((l) => !esBancoCaja(l.codigo));

    if (otrasLines.length === 0 && bancoLines.length >= 2) {
      // Transferencia entre cuentas propias.
      for (const b of bancoLines) {
        const flow = b.debeM.minus(b.haberM);
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
      const flow = l.haberM.minus(l.debeM);
      if (flow.abs().lt(0.01)) continue;
      contrapartidaNetaPorMes.set(
        mes,
        (contrapartidaNetaPorMes.get(mes) ?? new Decimal(0)).plus(flow),
      );
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
    const totalPeriodo = sumMoney(Object.values(valoresPorMes).map((v) => v.monto));
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
      node.totalPeriodo = sumMoney(node.children.map((ch) => ch.totalPeriodo));
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
    const totalPeriodo = sumMoney(Object.values(valoresPorMes).map((v) => v.monto));
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

  // 7) Totales por mes — calculados sobre el LADO BANCO (Δ de las cuentas
  //    banco/caja de la moneda), de modo que saldoAcumulado cuadre con
  //    calcularSaldosCuentasBancariasEnMonedaCuenta cuando `hasta` cubre todo
  //    el historial. Si el detalle por contrapartida no cuadra con el banco
  //    en un mes (pago/transferencia cross-moneda), se emite advertencia.
  const totalIngresosPorMes: Record<string, Decimal> = {};
  const totalEgresosPorMes: Record<string, Decimal> = {};
  const saldoMensalPorMes: Record<string, Decimal> = {};
  const saldoAcumuladoPorMes: Record<string, Decimal> = {};

  let acum = saldoInicial;
  for (const m of meses) {
    const ingresos = (ingresosBancoPorMes.get(m) ?? new Decimal(0)).toDecimalPlaces(2);
    const egresos = (egresosBancoPorMes.get(m) ?? new Decimal(0)).toDecimalPlaces(2);
    totalIngresosPorMes[m] = ingresos;
    totalEgresosPorMes[m] = egresos;
    const saldo = ingresos.plus(egresos); // egresos ya negativo
    saldoMensalPorMes[m] = saldo.toDecimalPlaces(2);
    acum = acum.plus(saldo);
    saldoAcumuladoPorMes[m] = acum.toDecimalPlaces(2);

    const contraNeta = contrapartidaNetaPorMes.get(m) ?? new Decimal(0);
    if (contraNeta.minus(saldo).abs().gte(0.01)) {
      advertencias.push(
        `${m}: el detalle por contrapartida (${contraNeta.toFixed(2)}) no cuadra con el movimiento de bancos (${saldo.toFixed(2)}) — hay pagos o transferencias en otra moneda.`,
      );
    }
  }

  // Poda defensiva: remove nós sem movimento (totalPeriodo 0 e todos os
  // meses 0), preservando pais com filhos movimentados. Cobre casos como
  // un banco em `transferencias` sin transferencias en el período. Não
  // altera os totales (calculados arriba sobre o lado banco).
  const sinMovimiento = (node: FlujoNode): boolean =>
    node.totalPeriodo.isZero() && Object.values(node.valoresPorMes).every((c) => c.monto.isZero());
  const prunearFlujo = (nodes: FlujoNode[]): FlujoNode[] => {
    const prune = (node: FlujoNode): FlujoNode | null => {
      const children = node.children.map(prune).filter((n): n is FlujoNode => n !== null);
      if (children.length === 0 && sinMovimiento(node)) return null;
      return { ...node, children };
    };
    return nodes.map(prune).filter((n): n is FlujoNode => n !== null);
  };

  return {
    moneda,
    desde,
    hasta,
    meses,
    contrapartidas: prunearFlujo(contrapartidasRoots),
    transferencias: prunearFlujo(transferenciasNodes),
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
