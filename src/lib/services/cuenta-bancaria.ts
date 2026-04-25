import "server-only";

import Decimal from "decimal.js";

import { db } from "@/lib/db";
import { toDecimal } from "@/lib/decimal";
import { AsientoEstado, Prisma } from "@/generated/prisma/client";

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
    result.set(
      row.cuentaId,
      debe.minus(haber).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    );
  }
  return result;
}
