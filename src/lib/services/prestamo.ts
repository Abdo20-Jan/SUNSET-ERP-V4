import "server-only";

import Decimal from "decimal.js";

import { db } from "@/lib/db";
import { toDecimal, type MoneyInput } from "@/lib/decimal";
import {
  AsientoEstado,
  Moneda,
  MovimientoTesoreriaTipo,
  Prisma,
} from "@/generated/prisma/client";

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

export type SaldoSuficienteResult =
  | { ok: true; saldoActual: Decimal }
  | {
      ok: false;
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
    result.set(
      row.cuentaId,
      haber.minus(debe).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    );
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
    tipoCambio: toDecimal(m.tipoCambio).toDecimalPlaces(
      6,
      Decimal.ROUND_HALF_UP,
    ),
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
    totalMonto: toDecimal(agg._sum.monto ?? 0).toDecimalPlaces(
      2,
      Decimal.ROUND_HALF_UP,
    ),
    ultimaFecha: agg._max.fecha ?? null,
  };
}

export async function validarSaldoSuficientePrestamo(
  cuentaContableId: number,
  intentoArs: MoneyInput,
  tx?: TxClient,
): Promise<SaldoSuficienteResult> {
  const saldoActual = await calcularSaldoPrestamo(cuentaContableId, tx);
  const intento = toDecimal(intentoArs).toDecimalPlaces(
    2,
    Decimal.ROUND_HALF_UP,
  );

  if (intento.lte(saldoActual)) {
    return { ok: true, saldoActual };
  }

  return {
    ok: false,
    saldoActual,
    intento,
    faltante: intento
      .minus(saldoActual)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
  };
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
