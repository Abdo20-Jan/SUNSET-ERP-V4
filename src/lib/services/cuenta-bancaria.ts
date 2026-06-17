import "server-only";

import Decimal from "decimal.js";

import { db } from "@/lib/db";
import { toDecimal } from "@/lib/decimal";
import { PREFIJO_BANCOS, PREFIJO_CAJA } from "@/lib/services/prefijos-plan";
import { AsientoEstado, CuentaTipo, Moneda, Prisma } from "@/generated/prisma/client";

type TxClient = Prisma.TransactionClient;

export async function calcularSaldoCuentaBancaria(
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
  return debe.minus(haber).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export async function calcularSaldosCuentasBancarias(
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
    result.set(row.cuentaId, debe.minus(haber).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
  }
  return result;
}

export type CuentaBancariaSaldoKey = { cuentaContableId: number; moneda: Moneda };

/**
 * Saldo de cada cuenta bancaria EN LA MONEDA DE LA CUENTA.
 *
 * - ARS: suma debe − haber del ledger (libro diario en pesos).
 * - USD: el debe/haber del ledger está en ARS (convención ARS-único), así que
 *   el saldo USD sale del principal por línea: Σ ± montoOrigen de las líneas
 *   con monedaOrigen=USD, más el fallback legado — líneas SIN metadata de
 *   asientos con moneda=USD, donde el debe/haber se grababa en USD crudo.
 *   Una línea ARS sin metadata sobre una cuenta USD no define principal USD
 *   (no hay TC para inferirlo) y queda fuera del saldo USD.
 */
export async function calcularSaldosCuentasBancariasEnMonedaCuenta(
  cuentas: CuentaBancariaSaldoKey[],
  tx?: TxClient,
): Promise<Map<number, Decimal>> {
  const client = tx ?? db;
  const result = new Map<number, Decimal>();
  if (cuentas.length === 0) return result;

  const arsIds = cuentas.filter((c) => c.moneda === Moneda.ARS).map((c) => c.cuentaContableId);
  const usdIds = cuentas.filter((c) => c.moneda !== Moneda.ARS).map((c) => c.cuentaContableId);

  if (arsIds.length > 0) {
    const saldosArs = await calcularSaldosCuentasBancarias(arsIds, tx);
    for (const [id, saldo] of saldosArs) result.set(id, saldo);
  }

  if (usdIds.length > 0) {
    for (const id of usdIds) result.set(id, new Decimal(0));

    const [conMetadata, legadoUsdCrudo] = await Promise.all([
      client.lineaAsiento.findMany({
        where: {
          cuentaId: { in: usdIds },
          monedaOrigen: Moneda.USD,
          asiento: { estado: AsientoEstado.CONTABILIZADO },
        },
        select: { cuentaId: true, debe: true, montoOrigen: true },
      }),
      client.lineaAsiento.findMany({
        where: {
          cuentaId: { in: usdIds },
          monedaOrigen: null,
          asiento: { estado: AsientoEstado.CONTABILIZADO, moneda: Moneda.USD },
        },
        select: { cuentaId: true, debe: true, haber: true },
      }),
    ]);

    for (const l of conMetadata) {
      const usd = toDecimal(l.montoOrigen ?? 0);
      const delta = toDecimal(l.debe).gt(0) ? usd : usd.neg();
      result.set(l.cuentaId, (result.get(l.cuentaId) ?? new Decimal(0)).plus(delta));
    }
    for (const l of legadoUsdCrudo) {
      const delta = toDecimal(l.debe).minus(toDecimal(l.haber));
      result.set(l.cuentaId, (result.get(l.cuentaId) ?? new Decimal(0)).plus(delta));
    }
    for (const id of usdIds) {
      result.set(id, (result.get(id) ?? new Decimal(0)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
    }
  }

  return result;
}

/**
 * Infiere la moneda de una cuenta banco/caja por su nombre cuando no hay una
 * `CuentaBancaria` ligada (caso típico de las cajas). Cuentas con "DÓLAR"/
 * "DOLAR" en el nombre se asumen USD; el resto, ARS.
 */
export function inferirMonedaPorNombre(nombre: string): Moneda {
  return /D[ÓO]LAR/i.test(nombre) ? Moneda.USD : Moneda.ARS;
}

export type CuentaBancoCajaConMoneda = {
  cuentaContableId: number;
  codigo: string;
  nombre: string;
  banco: string | null;
  moneda: Moneda;
};

/**
 * Cuentas analíticas activas de banco/caja (códigos 1.1.1.* / 1.1.2.*) con su
 * MONEDA derivada de la `CuentaBancaria` ligada (`cb?.moneda`), cayendo en
 * `inferirMonedaPorNombre` cuando no hay ninguna. Es la FUENTE ÚNICA de la
 * moneda de la cuenta usada tanto por `getSaldosBancarios` como por el flujo
 * de caja, para que ambos particionen idénticamente a la moneda de la cuenta
 * (alineado con `calcularSaldosCuentasBancariasEnMonedaCuenta`).
 */
export async function getCuentasBancoCajaConMoneda(
  tx?: TxClient,
): Promise<CuentaBancoCajaConMoneda[]> {
  const client = tx ?? db;
  const cuentas = await client.cuentaContable.findMany({
    where: {
      tipo: CuentaTipo.ANALITICA,
      activa: true,
      OR: [{ codigo: { startsWith: PREFIJO_CAJA } }, { codigo: { startsWith: PREFIJO_BANCOS } }],
    },
    select: {
      id: true,
      codigo: true,
      nombre: true,
      cuentasBancarias: { select: { banco: true, moneda: true }, take: 1 },
    },
    orderBy: { codigo: "asc" },
  });

  return cuentas.map((c) => {
    const cb = c.cuentasBancarias[0];
    return {
      cuentaContableId: c.id,
      codigo: c.codigo,
      nombre: c.nombre,
      banco: cb?.banco ?? null,
      moneda: cb?.moneda ?? inferirMonedaPorNombre(c.nombre),
    };
  });
}
