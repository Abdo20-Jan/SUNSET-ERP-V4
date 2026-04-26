import "server-only";

import { db } from "@/lib/db";
import { Decimal, toDecimal } from "@/lib/decimal";
import {
  AsientoEstado,
  CompraEstado,
  EmbarqueEstado,
  type CuentaCategoria,
  type Moneda,
} from "@/generated/prisma/client";

import {
  assertOwnershipUnico,
  FLUJO_CAJA_ESTRUCTURA,
  type FlujoDireccion,
  type FlujoSeccionId,
} from "./flujo-caja-config";
import { listarMeses, mesKey, saldoPorCategoria } from "./shared";

export type FlujoOrigen = "REALIZADO" | "PROYECTADO";

export type FlujoCelula = {
  monto: Decimal;
  origen: FlujoOrigen;
};

export type FlujoItemRow = {
  label: string;
  cuentaCodigos: string[];
  valores: Record<string, FlujoCelula>;
};

export type FlujoSubseccionRow = {
  label: string;
  items: FlujoItemRow[];
};

export type FlujoSeccionRow = {
  id: FlujoSeccionId;
  label: string;
  direccion: FlujoDireccion;
  subsecciones: FlujoSubseccionRow[];
};

export type FlujoCajaResult = {
  moneda: Moneda;
  desde: Date;
  hasta: Date;
  meses: string[];
  secciones: FlujoSeccionRow[];
  totales: {
    totalSalidasPorMes: Record<string, Decimal>;
    totalIngresosPorMes: Record<string, Decimal>;
    saldoMensalPorMes: Record<string, Decimal>;
    saldoInicial: Decimal;
    saldoAcumuladoPorMes: Record<string, Decimal>;
  };
  advertencias: string[];
};

/**
 * Matriz de Fluxo de Caja.
 *
 * - Realizado (mês ≤ mês corrente): extraído de `LineaAsiento` com `asiento.estado = CONTABILIZADO`
 *   e `asiento.moneda = moneda`. Não há conversão entre moedas: cada matriz é filtrada na sua moeda.
 * - Projetado (mês > mês corrente): usa `Embarque` em estados pendentes (não BORRADOR, não CERRADO)
 *   alocado no primeiro mês futuro do range; `Compra` em BORRADOR/EMITIDA alocada ao mês atual.
 *   **Limitação conhecida**: `Embarque` e `Compra` não têm `fechaPrevista`/`fechaVencimiento` no schema;
 *   a distribuição é aproximada e uma advertência é retornada.
 */
export async function getFlujoCaja(
  desde: Date,
  hasta: Date,
  moneda: Moneda,
): Promise<FlujoCajaResult> {
  assertOwnershipUnico();
  const meses = listarMeses(desde, hasta);
  const mesAtualKey = mesKey(new Date());
  const proximoMesFuturo = meses.find((m) => m > mesAtualKey);

  // ---- 1. Buscar códigos de conta únicos + mapa codigo → {id, categoria}.
  const codigosUsados = new Set<string>();
  for (const sec of FLUJO_CAJA_ESTRUCTURA) {
    for (const sub of sec.subsecciones) {
      for (const item of sub.items) {
        for (const c of item.cuentaCodigos) codigosUsados.add(c);
      }
    }
  }
  const cuentas = await db.cuentaContable.findMany({
    where: { codigo: { in: Array.from(codigosUsados) } },
    select: { id: true, codigo: true, categoria: true },
  });
  const codigoToInfo = new Map<
    string,
    { id: number; categoria: CuentaCategoria }
  >();
  for (const c of cuentas) {
    codigoToInfo.set(c.codigo, { id: c.id, categoria: c.categoria });
  }
  const cuentaIds = cuentas.map((c) => c.id);

  // ---- 2. Buscar lineas contabilizadas no range por mês.
  const desdeUtc = firstDayOfMonth(desde);
  const hastaUtc = lastDayOfMonth(hasta);
  const lineas =
    cuentaIds.length === 0
      ? []
      : await db.lineaAsiento.findMany({
          where: {
            cuentaId: { in: cuentaIds },
            asiento: {
              estado: AsientoEstado.CONTABILIZADO,
              moneda,
              fecha: { gte: desdeUtc, lte: hastaUtc },
            },
          },
          select: {
            cuentaId: true,
            debe: true,
            haber: true,
            asiento: { select: { fecha: true } },
          },
        });

  // Agrupa por cuentaId × mesKey → natural saldo (decimal.js).
  const realizadoPorCuentaMes = new Map<string, Decimal>();
  for (const l of lineas) {
    const info = cuentas.find((c) => c.id === l.cuentaId);
    if (!info) continue;
    const mk = mesKey(l.asiento.fecha);
    const signed = saldoPorCategoria(
      toDecimal(l.debe),
      toDecimal(l.haber),
      info.categoria,
    );
    const key = `${l.cuentaId}|${mk}`;
    const prev = realizadoPorCuentaMes.get(key) ?? new Decimal(0);
    realizadoPorCuentaMes.set(key, prev.plus(signed));
  }

  // ---- 3. Projetados: Embarques em trânsito + Compras pendentes.
  const advertencias: string[] = [];
  const proyeccionPorCuentaMes = new Map<string, Decimal>();

  if (proximoMesFuturo) {
    const embarques = await db.embarque.findMany({
      where: {
        moneda,
        estado: {
          in: [
            EmbarqueEstado.EN_TRANSITO,
            EmbarqueEstado.EN_PUERTO,
            EmbarqueEstado.EN_ADUANA,
            EmbarqueEstado.DESPACHADO,
            EmbarqueEstado.EN_DEPOSITO,
          ],
        },
      },
      select: {
        id: true,
        tipoCambio: true,
        die: true,
        tasaEstadistica: true,
        arancelSim: true,
        iva: true,
        ivaAdicional: true,
        ganancias: true,
        iibb: true,
        costos: {
          select: {
            tipoCambio: true,
            lineas: {
              select: {
                subtotal: true,
                cuentaContableGastoId: true,
              },
            },
          },
        },
      },
    });

    if (embarques.length > 0) {
      advertencias.push(
        `${embarques.length} embarque(s) en tránsito proyectado(s) en ${proximoMesFuturo}. El schema no tiene fechaPrevistaNacionalizacion; la distribución temporal es una aproximación.`,
      );
    }

    // Tributos aduaneros — campos planos del Embarque, mapeados a cuentas fijas.
    const mapEmbarque: Array<
      [
        Exclude<keyof (typeof embarques)[number], "id" | "tipoCambio" | "costos">,
        string,
      ]
    > = [
      ["die", "5.7.1.01"],
      ["tasaEstadistica", "5.7.1.02"],
      ["arancelSim", "5.7.1.03"],
      ["iva", "1.1.4.04"],
      ["ivaAdicional", "1.1.4.05"],
      ["iibb", "1.1.4.06"],
      ["ganancias", "1.1.4.07"],
    ];

    const idToInfo = new Map(cuentas.map((c) => [c.id, c]));

    for (const emb of embarques) {
      for (const [campo, codigo] of mapEmbarque) {
        const info = codigoToInfo.get(codigo);
        if (!info) continue;
        const valor = toDecimal(emb[campo] as unknown as Decimal.Value);
        if (valor.isZero()) continue;
        const key = `${info.id}|${proximoMesFuturo}`;
        const prev = proyeccionPorCuentaMes.get(key) ?? new Decimal(0);
        proyeccionPorCuentaMes.set(key, prev.plus(valor));
      }
      // Costos logísticos por proveedor: cada factura tiene N líneas;
      // proyectamos el subtotal de cada línea en ARS al mes futuro,
      // distribuido en la cuenta de gasto elegida.
      for (const factura of emb.costos) {
        const tc = toDecimal(factura.tipoCambio);
        for (const linea of factura.lineas) {
          const info = idToInfo.get(linea.cuentaContableGastoId);
          if (!info) continue;
          const subtotalArs = toDecimal(linea.subtotal).times(tc);
          if (subtotalArs.isZero()) continue;
          const key = `${info.id}|${proximoMesFuturo}`;
          const prev = proyeccionPorCuentaMes.get(key) ?? new Decimal(0);
          proyeccionPorCuentaMes.set(key, prev.plus(subtotalArs));
        }
      }
    }

    const comprasPendientes = await db.compra.count({
      where: {
        moneda,
        estado: { in: [CompraEstado.BORRADOR, CompraEstado.EMITIDA] },
      },
    });
    if (comprasPendientes > 0) {
      advertencias.push(
        `${comprasPendientes} compra(s) pendiente(s) no proyectadas: el schema no tiene fechaVencimiento. Considere agregar el campo para proyección fiel.`,
      );
    }
  }

  // ---- 4. Montar linhas do relatório.
  const secciones: FlujoSeccionRow[] = FLUJO_CAJA_ESTRUCTURA.map((sec) => ({
    id: sec.id,
    label: sec.label,
    direccion: sec.direccion,
    subsecciones: sec.subsecciones.map((sub) => ({
      label: sub.label,
      items: sub.items.map((item) => {
        const valores: Record<string, FlujoCelula> = {};
        for (const m of meses) {
          let monto = new Decimal(0);
          let tieneProyectado = false;
          for (const codigo of item.cuentaCodigos) {
            const info = codigoToInfo.get(codigo);
            if (!info) continue;
            const keyRealizado = `${info.id}|${m}`;
            const r = realizadoPorCuentaMes.get(keyRealizado);
            if (r) monto = monto.plus(r);
            const p = proyeccionPorCuentaMes.get(keyRealizado);
            if (p) {
              monto = monto.plus(p);
              tieneProyectado = true;
            }
          }
          valores[m] = {
            monto: monto.toDecimalPlaces(2),
            origen:
              tieneProyectado && m > mesAtualKey ? "PROYECTADO" : "REALIZADO",
          };
        }
        return {
          label: item.label,
          cuentaCodigos: [...item.cuentaCodigos],
          valores,
        };
      }),
    })),
  }));

  // ---- 5. Totais por mês.
  const totalSalidasPorMes: Record<string, Decimal> = {};
  const totalIngresosPorMes: Record<string, Decimal> = {};
  const saldoMensalPorMes: Record<string, Decimal> = {};
  for (const m of meses) {
    let salidas = new Decimal(0);
    let ingresos = new Decimal(0);
    for (const sec of secciones) {
      for (const sub of sec.subsecciones) {
        for (const item of sub.items) {
          const v = item.valores[m]?.monto ?? new Decimal(0);
          if (sec.direccion === "SALIDA") salidas = salidas.plus(v);
          else ingresos = ingresos.plus(v);
        }
      }
    }
    totalSalidasPorMes[m] = salidas.toDecimalPlaces(2);
    totalIngresosPorMes[m] = ingresos.toDecimalPlaces(2);
    saldoMensalPorMes[m] = ingresos.minus(salidas).toDecimalPlaces(2);
  }

  // ---- 6. Saldo inicial: soma dos saldos atuais de CuentaBancaria na moeda alvo.
  const saldoInicial = await calcularSaldoInicialCajaBancos(moneda);

  // ---- 7. Saldo acumulado.
  const saldoAcumuladoPorMes: Record<string, Decimal> = {};
  let acumulado = saldoInicial;
  for (const m of meses) {
    acumulado = acumulado.plus(saldoMensalPorMes[m]);
    saldoAcumuladoPorMes[m] = acumulado.toDecimalPlaces(2);
  }

  return {
    moneda,
    desde,
    hasta,
    meses,
    secciones,
    totales: {
      totalSalidasPorMes,
      totalIngresosPorMes,
      saldoMensalPorMes,
      saldoInicial: saldoInicial.toDecimalPlaces(2),
      saldoAcumuladoPorMes,
    },
    advertencias,
  };
}

async function calcularSaldoInicialCajaBancos(
  moneda: Moneda,
): Promise<Decimal> {
  const cuentasBancarias = await db.cuentaBancaria.findMany({
    where: { moneda },
    select: { cuentaContableId: true },
  });
  const ids = cuentasBancarias.map((c) => c.cuentaContableId);
  if (ids.length === 0) return new Decimal(0);

  const agregados = await db.lineaAsiento.groupBy({
    by: ["cuentaId"],
    where: {
      cuentaId: { in: ids },
      asiento: { estado: AsientoEstado.CONTABILIZADO, moneda },
    },
    _sum: { debe: true, haber: true },
  });

  let total = new Decimal(0);
  for (const a of agregados) {
    total = total
      .plus(toDecimal(a._sum.debe ?? 0))
      .minus(toDecimal(a._sum.haber ?? 0));
  }
  return total;
}

function firstDayOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

function lastDayOfMonth(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999),
  );
}
