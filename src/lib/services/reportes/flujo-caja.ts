import "server-only";

import { db } from "@/lib/db";
import { Decimal, sumMoney, toDecimal } from "@/lib/decimal";
import { getCuentasBancoCajaConMoneda } from "@/lib/services/cuenta-bancaria";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { PREFIJOS_BANCO_CAJA } from "@/lib/services/prefijos-plan";
import {
  AsientoEstado,
  type CuentaCategoria,
  type CuentaTipo,
  Moneda,
} from "@/generated/prisma/client";

import { convertirMoneda, listarMeses, mesKey } from "./shared";

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
 * Los importes están en la MONEDA DE PRESENTACIÓN (convertidos al TC de cierre).
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
  // Moneda de presentación del reporte (alias `moneda` por compatibilidad de UI).
  moneda: Moneda;
  monedaPresentacion: Moneda;
  // TC de cierre usado para convertir (última Cotizacion con fecha <= hasta).
  // null si no hay ninguna cotización cargada.
  tipoCambioCierre: Decimal | null;
  fechaCotizacionCierre: Date | null;
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
  // movimiento neto signado, convertido a la moneda de presentación.
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
 * Valor de una línea EN SU MONEDA NATIVA `M`, como par `{debeM, haberM}` de
 * MAGNITUDES no-negativas (el signo se deriva luego de `debeM − haberM`).
 * Para una cuenta banco/caja `M` = la moneda de la cuenta; para una
 * contrapartida `M` = USD si la línea trae `monedaOrigen=USD`, si no ARS.
 * Espelha `calcularSaldosCuentasBancariasEnMonedaCuenta`:
 *   - M=ARS: `debe`/`haber` crudos (el ledger es en pesos).
 *   - M=USD con `monedaOrigen=USD`: el lado con valor toma `montoOrigen` (el
 *     principal USD invariante a TC); el otro lado queda en 0.
 *   - M=USD legado (`monedaOrigen=null` y `asiento.moneda=USD`): `debe`/`haber`
 *     crudos, que en ese caso ya estaban grabados en USD.
 *   - resto (línea ARS sin metadata sobre una cuenta USD): `{0,0}` → no hay TC
 *     para inferir el principal USD.
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
 * Flujo de Caja real CONSOLIDADO + CONVERTIDO. Itera los asientos que tocan
 * alguna cuenta banco/caja (de CUALQUIER moneda) y presenta todo en
 * `monedaPresentacion` (USD por defecto en la UI), convirtiendo "todo al TC de
 * cierre" = la última `Cotizacion` con `fecha <= hasta`. Las cuentas en la
 * moneda de presentación quedan a su valor nativo; las de otra moneda se
 * convierten a ese único TC (decisión del dueño 2026-06-17: sin línea de
 * diferencia de cambio en el flujo — todo a la misma tasa).
 *
 * El valor nativo de cada línea sale de `valorEnMoneda` (montoOrigen para USD)
 * y luego se convierte con `convertirMoneda`. Los totales/saldo se calculan
 * sobre el LADO BANCO para que el saldo acumulado cuadre con
 * `calcularSaldosCuentasBancariasEnMonedaCuenta` (por cuenta, en su moneda
 * nativa) convertido al TC de cierre. El detalle por contrapartida es
 * cualitativo; si no cuadra con el banco en un mes (asiento mixto), se emite
 * advertencia.
 *
 * Sign convention por cuenta contrapartida:
 *   cashFlow = haberM − debeM (HABER → cash entró; DEBE → cash salió).
 */
export async function getFlujoCaja(
  desde: Date,
  hasta: Date,
  monedaPresentacion: Moneda,
): Promise<FlujoCajaResult> {
  const meses = listarMeses(desde, hasta);
  const advertencias: string[] = [];

  // Todas las cuentas banco/caja con su moneda nativa (fuente única compartida
  // con getSaldosBancarios → CuentaBancaria.moneda, igual a la función-âncora).
  const cuentasBC = await getCuentasBancoCajaConMoneda();
  const monedaPorCuenta = new Map<number, Moneda>(
    cuentasBC.map((c) => [c.cuentaContableId, c.moneda]),
  );

  // TC de cierre: última Cotizacion con fecha <= hasta (null si no hay ninguna).
  const tcRow = await getCotizacionParaFecha(hasta);
  const tipoCambioCierre = tcRow?.valor ?? null;
  const fechaCotizacionCierre = tcRow?.fecha ?? null;
  let requiereTc = false;

  // Convierte un valor NATIVO de `monedaNativa` a la moneda de presentación.
  const aPresentacion = (valorNativo: Decimal, monedaNativa: Moneda): Decimal => {
    if (monedaNativa === monedaPresentacion) return valorNativo;
    if (tipoCambioCierre === null) {
      requiereTc = true;
      return new Decimal(0);
    }
    return convertirMoneda(valorNativo, monedaNativa, tipoCambioCierre, monedaPresentacion);
  };

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

  if (monedaPorCuenta.size === 0) {
    advertencias.push("No hay cuentas de banco/caja configuradas.");
    return {
      moneda: monedaPresentacion,
      monedaPresentacion,
      tipoCambioCierre,
      fechaCotizacionCierre,
      desde,
      hasta,
      meses,
      contrapartidas: [],
      transferencias: [],
      totales: totalesVacios(),
      advertencias,
    };
  }

  const bancoCajaIdArray = Array.from(monedaPorCuenta.keys());

  // 1) Saldo inicial (full precision): líneas de las cuentas banco/caja con
  //    asientos contabilizados ANTES de `desde`. Vía findMany (no aggregate)
  //    porque USD necesita montoOrigen línea a línea y cada cuenta tiene su
  //    propia moneda nativa.
  const lineasIniciales = await db.lineaAsiento.findMany({
    where: {
      cuentaId: { in: bancoCajaIdArray },
      asiento: { estado: AsientoEstado.CONTABILIZADO, fecha: { lt: desde } },
    },
    select: {
      cuentaId: true,
      debe: true,
      haber: true,
      monedaOrigen: true,
      montoOrigen: true,
      asiento: { select: { moneda: true } },
    },
  });
  let saldoInicialRaw = new Decimal(0);
  for (const l of lineasIniciales) {
    const nativa = monedaPorCuenta.get(l.cuentaId) ?? Moneda.ARS;
    const { debeM, haberM } = valorEnMoneda(
      {
        debe: toDecimal(l.debe),
        haber: toDecimal(l.haber),
        monedaOrigen: l.monedaOrigen,
        montoOrigen: l.montoOrigen != null ? toDecimal(l.montoOrigen) : null,
      },
      nativa,
      l.asiento.moneda,
    );
    saldoInicialRaw = saldoInicialRaw.plus(aPresentacion(debeM.minus(haberM), nativa));
  }

  // 2) Asientos del período que tocan ALGUNA cuenta banco/caja.
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
  //    TOTALES/saldo salen del lado banco (cuentaId ∈ banco/caja) en la moneda
  //    de presentación — eso es lo que cuadra con la âncora.
  const flujoPorCuenta = new Map<number, Map<string, Decimal>>();
  const transferenciasPorBanco = new Map<number, Map<string, Decimal>>();
  const ingresosBancoPorMes = new Map<string, Decimal>();
  const egresosBancoPorMes = new Map<string, Decimal>();
  const contrapartidaNetaPorMes = new Map<string, Decimal>();

  const acumular = (mapa: Map<string, Decimal>, mes: string, valor: Decimal): void => {
    mapa.set(mes, (mapa.get(mes) ?? new Decimal(0)).plus(valor));
  };

  type MoneyInput = Parameters<typeof toDecimal>[0];
  const valorNativoLinea = (
    l: {
      debe: MoneyInput;
      haber: MoneyInput;
      monedaOrigen: Moneda | null;
      montoOrigen: MoneyInput | null;
    },
    nativa: Moneda,
    asientoMoneda: Moneda,
  ): Decimal => {
    const { debeM, haberM } = valorEnMoneda(
      {
        debe: toDecimal(l.debe),
        haber: toDecimal(l.haber),
        monedaOrigen: l.monedaOrigen,
        montoOrigen: l.montoOrigen != null ? toDecimal(l.montoOrigen) : null,
      },
      nativa,
      asientoMoneda,
    );
    return debeM.minus(haberM);
  };

  for (const a of asientos) {
    const mes = mesKey(a.fecha);

    // Lado banco (base del invariante): Δ_P = valor nativo (debeM − haberM)
    // convertido al TC de cierre. SIN corte sub-centavo (FC-2): se acumula en
    // precisión plena y se redondea sólo al final, para no perder dinero ni
    // descuadrar contra la âncora.
    for (const l of a.lineas) {
      const nativa = monedaPorCuenta.get(l.cuentaId);
      if (nativa === undefined) continue; // no es banco/caja
      const deltaP = aPresentacion(valorNativoLinea(l, nativa, a.moneda), nativa);
      if (deltaP.gt(0)) acumular(ingresosBancoPorMes, mes, deltaP);
      else if (deltaP.lt(0)) acumular(egresosBancoPorMes, mes, deltaP);
    }

    // Detalle: clasificar banco-vs-contrapartida por CÓDIGO (para seguir
    // detectando transferencias entre cuentas propias como tales).
    const bancoLines = a.lineas.filter((l) => esBancoCaja(l.cuenta.codigo));
    const otrasLines = a.lineas.filter((l) => !esBancoCaja(l.cuenta.codigo));

    if (otrasLines.length === 0 && bancoLines.length >= 2) {
      // Transferencia entre cuentas propias: cada pierna en moneda de presentación.
      for (const b of bancoLines) {
        const nativa = monedaPorCuenta.get(b.cuentaId) ?? Moneda.ARS;
        const flowP = aPresentacion(valorNativoLinea(b, nativa, a.moneda), nativa);
        let porMes = transferenciasPorBanco.get(b.cuentaId);
        if (!porMes) {
          porMes = new Map();
          transferenciasPorBanco.set(b.cuentaId, porMes);
        }
        porMes.set(mes, (porMes.get(mes) ?? new Decimal(0)).plus(flowP));
      }
      continue;
    }

    for (const l of otrasLines) {
      const nativaCP = l.monedaOrigen === Moneda.USD ? Moneda.USD : Moneda.ARS;
      // cashFlow contrapartida = haberM − debeM = −(debeM − haberM) nativo.
      const flowP = aPresentacion(valorNativoLinea(l, nativaCP, a.moneda).negated(), nativaCP);
      acumular(contrapartidaNetaPorMes, mes, flowP);
      let porMes = flujoPorCuenta.get(l.cuentaId);
      if (!porMes) {
        porMes = new Map();
        flujoPorCuenta.set(l.cuentaId, porMes);
      }
      porMes.set(mes, (porMes.get(mes) ?? new Decimal(0)).plus(flowP));
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

  // 5) Construir tree (cuentas contrapartida). Las celdas de las analíticas se
  //    redondean a 2 decimales para exhibición.
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

  // Roll-up bottom-up: el subtotal sintético es la SUMA de las celdas (ya
  // redondeadas) de sus hijos → coincide exactamente con lo exhibido (FC-2).
  const rollUp = (node: FlujoNode): void => {
    if (node.tipo === "SINTETICA" && node.children.length > 0) {
      for (const ch of node.children) rollUp(ch);
      for (const m of meses) {
        const sumChildren = node.children.reduce(
          (acc, ch) => acc.plus(ch.valoresPorMes[m]?.monto ?? new Decimal(0)),
          new Decimal(0),
        );
        node.valoresPorMes[m] = { monto: sumChildren, origen: "REALIZADO" };
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
  //    banco/caja convertido al TC de cierre). El saldo acumulado se lleva en
  //    precisión plena (running sum) y se redondea al exhibir, de modo que el
  //    saldo final cuadre con Σ saldos de banco convertidos al TC de cierre.
  const totalIngresosPorMes: Record<string, Decimal> = {};
  const totalEgresosPorMes: Record<string, Decimal> = {};
  const saldoMensalPorMes: Record<string, Decimal> = {};
  const saldoAcumuladoPorMes: Record<string, Decimal> = {};

  let acumRaw = saldoInicialRaw;
  for (const m of meses) {
    const ingresosRaw = ingresosBancoPorMes.get(m) ?? new Decimal(0);
    const egresosRaw = egresosBancoPorMes.get(m) ?? new Decimal(0);
    const saldoRaw = ingresosRaw.plus(egresosRaw); // egresos ya negativo
    acumRaw = acumRaw.plus(saldoRaw);

    totalIngresosPorMes[m] = ingresosRaw.toDecimalPlaces(2);
    totalEgresosPorMes[m] = egresosRaw.toDecimalPlaces(2);
    saldoMensalPorMes[m] = saldoRaw.toDecimalPlaces(2);
    saldoAcumuladoPorMes[m] = acumRaw.toDecimalPlaces(2);

    const contraNeta = contrapartidaNetaPorMes.get(m) ?? new Decimal(0);
    if (contraNeta.minus(saldoRaw).abs().gte(0.01)) {
      advertencias.push(
        `${m}: el detalle por contrapartida (${contraNeta.toFixed(2)}) no cuadra con el movimiento de bancos (${saldoRaw.toFixed(2)}) — hay pagos o transferencias en otra moneda.`,
      );
    }
  }

  if (requiereTc) {
    advertencias.push(
      `No hay cotización con fecha ≤ ${hasta.toISOString().slice(0, 10)}; las cuentas en una moneda distinta de ${monedaPresentacion} quedaron fuera del reporte.`,
    );
  }

  // Poda defensiva: remove nós sem movimento (totalPeriodo 0 e todos os
  // meses 0), preservando pais com filhos movimentados. Não altera os totales
  // (calculados arriba sobre o lado banco).
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
    moneda: monedaPresentacion,
    monedaPresentacion,
    tipoCambioCierre,
    fechaCotizacionCierre,
    desde,
    hasta,
    meses,
    contrapartidas: prunearFlujo(contrapartidasRoots),
    transferencias: prunearFlujo(transferenciasNodes),
    totales: {
      totalIngresosPorMes,
      totalEgresosPorMes,
      saldoMensalPorMes,
      saldoInicial: saldoInicialRaw.toDecimalPlaces(2),
      saldoAcumuladoPorMes,
    },
    advertencias,
  };
}

function celulaCero(): FlujoCelula {
  return { monto: new Decimal(0), origen: "REALIZADO" };
}
