import Decimal from "decimal.js";

import { Prisma } from "@/generated/prisma/client";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type MoneyInput = Decimal.Value | Prisma.Decimal;

export function toDecimal(value: MoneyInput): Decimal {
  if (value instanceof Decimal) return value;
  return new Decimal(value.toString());
}

export function sumMoney(values: MoneyInput[]): Decimal {
  return values
    .reduce<Decimal>((acc, v) => acc.plus(toDecimal(v)), new Decimal(0))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function eqMoney(a: MoneyInput, b: MoneyInput): boolean {
  return toDecimal(a)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .eq(toDecimal(b).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
}

export function gtZero(value: MoneyInput): boolean {
  return toDecimal(value).gt(0);
}

export function money(value: MoneyInput): Prisma.Decimal {
  return new Prisma.Decimal(
    toDecimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
  );
}

/** Precio unitario con hasta 4 decimales (vs money() que redondea a 2). */
export function precioUnitario(value: MoneyInput): Prisma.Decimal {
  return new Prisma.Decimal(
    toDecimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
  );
}

export { Decimal };
