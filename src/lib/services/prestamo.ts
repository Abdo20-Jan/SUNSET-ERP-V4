import "server-only";

import Decimal from "decimal.js";

import { db } from "@/lib/db";
import { toDecimal, type MoneyInput } from "@/lib/decimal";
import { AsientoEstado, Moneda, MovimientoTesoreriaTipo, Prisma } from "@/generated/prisma/client";

type TxClient = Prisma.TransactionClient;

export type AmortizacionPrestamo = {
  movimientoId: string;
  fecha: Date;
  monto: Decimal;
  moneda: Moneda;
  tipoCambio: Decimal;
  cuentaBancaria: { id: string; banco: string; numero: string | null };
  asiento: { id: string; numero: number; estado: AsientoEstado } | null;
  descripcion: string | null;
};

export type ResumenAmortizaciones = {
  count: number;
  totalMonto: Decimal;
  ultimaFecha: Date | null;
};

export type SaldoPrestamoMoneda = {
  /** Saldo en pesos (haber − debe sobre la cuenta del préstamo). */
  saldoArs: Decimal;
  /**
   * Saldo en USD derivado SÓLO de montoOrigen (invariante a TC, igual que el
   * balancete E5). `null` ⇒ la cuenta no tiene líneas USD = préstamo en ARS.
   */
  saldoUsd: Decimal | null;
};

export type SaldoSuficienteResult =
  | { ok: true; moneda: Moneda; saldoActual: Decimal }
  | {
      ok: false;
      moneda: Moneda;
      saldoActual: Decimal;
      intento: Decimal;
      faltante: Decimal;
    };

function whereAmortizacionesContabilizadas(cuentaContableId: number) {
  return {
    tipo: MovimientoTesoreriaTipo.PAGO,
    cuentaContableId,
    asiento: { estado: AsientoEstado.CONTABILIZADO },
  } satisfies Prisma.MovimientoTesoreriaWhereInput;
}

export async function calcularSaldoPrestamo(
  cuentaContableId: number,
  tx?: TxClient,
): Promise<Decimal> {
  const client = tx ?? db;
  const agg = await client.lineaAsiento.aggregate({
    where: {
      cuentaId: cuentaContableId,
      asiento: { estado: AsientoEstado.CONTABILIZADO },
    },
    _sum: { debe: true, haber: true },
  });
  const debe = toDecimal(agg._sum.debe ?? 0);
  const haber = toDecimal(agg._sum.haber ?? 0);
  return haber.minus(debe).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export async function calcularSaldosPrestamos(
  cuentaContableIds: number[],
  tx?: TxClient,
): Promise<Map<number, Decimal>> {
  const client = tx ?? db;
  const result = new Map<number, Decimal>();
  if (cuentaContableIds.length === 0) return result;

  const grouped = await client.lineaAsiento.groupBy({
    by: ["cuentaId"],
    where: {
      cuentaId: { in: cuentaContableIds },
      asiento: { estado: AsientoEstado.CONTABILIZADO },
    },
    _sum: { debe: true, haber: true },
  });

  for (const id of cuentaContableIds) {
    result.set(id, new Decimal(0));
  }
  for (const row of grouped) {
    const debe = toDecimal(row._sum.debe ?? 0);
    const haber = toDecimal(row._sum.haber ?? 0);
    result.set(row.cuentaId, haber.minus(debe).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
  }
  return result;
}

/**
 * Saldo del préstamo en su moneda nativa además del ARS. El saldo USD se
 * deriva de `montoOrigen` (canónico E5): es invariante a TC, y la diferencia
 * cambiaria de cada amortización va a 9.2.x — NO a la cuenta del préstamo —,
 * así que la cuenta queda valuada al TC de alta y el USD se mantiene exacto.
 */
export async function calcularSaldoPrestamoConMoneda(
  cuentaContableId: number,
  tx?: TxClient,
): Promise<SaldoPrestamoMoneda> {
  const client = tx ?? db;
  const saldoArs = await calcularSaldoPrestamo(cuentaContableId, tx);

  const lineasUsd = await client.lineaAsiento.findMany({
    where: {
      cuentaId: cuentaContableId,
      monedaOrigen: Moneda.USD,
      asiento: { estado: AsientoEstado.CONTABILIZADO },
    },
    select: { debe: true, haber: true, montoOrigen: true },
  });

  if (lineasUsd.length === 0) return { saldoArs, saldoUsd: null };

  let saldoUsd = new Decimal(0);
  for (const l of lineasUsd) {
    const usd = toDecimal(l.montoOrigen ?? 0);
    if (toDecimal(l.haber).gt(0)) saldoUsd = saldoUsd.plus(usd);
    if (toDecimal(l.debe).gt(0)) saldoUsd = saldoUsd.minus(usd);
  }
  return { saldoArs, saldoUsd: saldoUsd.toDecimalPlaces(2, Decimal.ROUND_HALF_UP) };
}

/** Variante batch de {@link calcularSaldoPrestamoConMoneda}. */
export async function calcularSaldosPrestamosConMoneda(
  cuentaContableIds: number[],
  tx?: TxClient,
): Promise<Map<number, SaldoPrestamoMoneda>> {
  const client = tx ?? db;
  const result = new Map<number, SaldoPrestamoMoneda>();
  if (cuentaContableIds.length === 0) return result;

  const saldosArs = await calcularSaldosPrestamos(cuentaContableIds, tx);

  const baseWhere = {
    cuentaId: { in: cuentaContableIds },
    monedaOrigen: Moneda.USD,
    asiento: { estado: AsientoEstado.CONTABILIZADO },
  } satisfies Prisma.LineaAsientoWhereInput;

  // Una línea USD es unilateral (debe>0 XOR haber>0); sumamos montoOrigen por
  // lado para obtener saldoUsd = Σ haber − Σ debe.
  const [haberRows, debeRows] = await Promise.all([
    client.lineaAsiento.groupBy({
      by: ["cuentaId"],
      where: { ...baseWhere, haber: { gt: 0 } },
      _sum: { montoOrigen: true },
    }),
    client.lineaAsiento.groupBy({
      by: ["cuentaId"],
      where: { ...baseWhere, debe: { gt: 0 } },
      _sum: { montoOrigen: true },
    }),
  ]);

  const usdHaber = new Map<number, Decimal>();
  const usdDebe = new Map<number, Decimal>();
  for (const r of haberRows) usdHaber.set(r.cuentaId, toDecimal(r._sum.montoOrigen ?? 0));
  for (const r of debeRows) usdDebe.set(r.cuentaId, toDecimal(r._sum.montoOrigen ?? 0));

  for (const id of cuentaContableIds) {
    const saldoArs = saldosArs.get(id) ?? new Decimal(0);
    const tieneUsd = usdHaber.has(id) || usdDebe.has(id);
    const saldoUsd = tieneUsd
      ? (usdHaber.get(id) ?? new Decimal(0))
          .minus(usdDebe.get(id) ?? new Decimal(0))
          .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      : null;
    result.set(id, { saldoArs, saldoUsd });
  }
  return result;
}

export async function listarAmortizacionesPrestamo(
  cuentaContableId: number,
  tx?: TxClient,
): Promise<AmortizacionPrestamo[]> {
  const client = tx ?? db;
  const rows = await client.movimientoTesoreria.findMany({
    where: whereAmortizacionesContabilizadas(cuentaContableId),
    orderBy: { fecha: "desc" },
    include: {
      cuentaBancaria: { select: { id: true, banco: true, numero: true } },
      asiento: { select: { id: true, numero: true, estado: true } },
    },
  });

  return rows.map((m) => ({
    movimientoId: m.id,
    fecha: m.fecha,
    monto: toDecimal(m.monto).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    moneda: m.moneda,
    tipoCambio: toDecimal(m.tipoCambio).toDecimalPlaces(6, Decimal.ROUND_HALF_UP),
    cuentaBancaria: {
      id: m.cuentaBancaria.id,
      banco: m.cuentaBancaria.banco,
      numero: m.cuentaBancaria.numero,
    },
    asiento: m.asiento
      ? {
          id: m.asiento.id,
          numero: m.asiento.numero,
          estado: m.asiento.estado,
        }
      : null,
    descripcion: m.descripcion,
  }));
}

export async function contarAmortizacionesContabilizadasPrestamo(
  cuentaContableId: number,
  tx?: TxClient,
): Promise<number> {
  const client = tx ?? db;
  return client.movimientoTesoreria.count({
    where: whereAmortizacionesContabilizadas(cuentaContableId),
  });
}

export async function resumirAmortizaciones(
  cuentaContableId: number,
  tx?: TxClient,
): Promise<ResumenAmortizaciones> {
  const client = tx ?? db;
  const agg = await client.movimientoTesoreria.aggregate({
    where: whereAmortizacionesContabilizadas(cuentaContableId),
    _count: { _all: true },
    _sum: { monto: true },
    _max: { fecha: true },
  });
  return {
    count: agg._count._all,
    totalMonto: toDecimal(agg._sum.monto ?? 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    ultimaFecha: agg._max.fecha ?? null,
  };
}

function buildSaldoSuficiente(
  moneda: Moneda,
  saldoActual: Decimal,
  intento: Decimal,
): SaldoSuficienteResult {
  if (intento.lte(saldoActual)) {
    return { ok: true, moneda, saldoActual };
  }
  return {
    ok: false,
    moneda,
    saldoActual,
    intento,
    faltante: intento.minus(saldoActual).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
  };
}

/**
 * Valida que un pago no exceda el saldo pendiente del préstamo, comparando en
 * la moneda correcta: un pago USD contra un préstamo USD-nato se valida en USD
 * (ambos invariantes a TC) — comparar el intento en ARS al TC del pago contra
 * el saldo en ARS al TC de alta rechazaba falsamente amortizaciones totales
 * cuando el peso se devaluaba. El resultado lleva la `moneda` para que el
 * mensaje de error use la unidad correcta.
 */
export async function validarSaldoSuficientePrestamo(
  cuentaContableId: number,
  intento: { monto: MoneyInput; moneda: Moneda; tipoCambio: MoneyInput },
  tx?: TxClient,
): Promise<SaldoSuficienteResult> {
  const { saldoArs, saldoUsd } = await calcularSaldoPrestamoConMoneda(cuentaContableId, tx);

  if (intento.moneda === Moneda.USD && saldoUsd !== null) {
    const intentoUsd = toDecimal(intento.monto).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    return buildSaldoSuficiente(Moneda.USD, saldoUsd, intentoUsd);
  }

  const intentoArs = toDecimal(intento.monto)
    .mul(toDecimal(intento.tipoCambio))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return buildSaldoSuficiente(Moneda.ARS, saldoArs, intentoArs);
}

export type PrestamoPorCuenta = {
  prestamoId: string;
  prestamista: string;
  asientoEstado: AsientoEstado | null;
};

export async function listarPrestamosPorCuentaContable(
  cuentaContableIds: number[],
  tx?: TxClient,
): Promise<Map<number, PrestamoPorCuenta>> {
  const client = tx ?? db;
  const result = new Map<number, PrestamoPorCuenta>();
  if (cuentaContableIds.length === 0) return result;

  const prestamos = await client.prestamoExterno.findMany({
    where: { cuentaContableId: { in: cuentaContableIds } },
    select: {
      id: true,
      prestamista: true,
      cuentaContableId: true,
      asiento: { select: { estado: true } },
    },
  });

  for (const p of prestamos) {
    result.set(p.cuentaContableId, {
      prestamoId: p.id,
      prestamista: p.prestamista,
      asientoEstado: p.asiento?.estado ?? null,
    });
  }
  return result;
}
