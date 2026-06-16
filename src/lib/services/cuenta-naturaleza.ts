import type { Decimal } from "@/lib/decimal";
import type { CuentaCategoria, Naturaleza } from "@/generated/prisma/client";

// Naturaleza del saldo de una cuenta: DEUDOR (saldo = debe - haber) o
// ACREEDOR (saldo = haber - debe). Es independiente de la categoría: las
// cuentas regularizadoras (p. ej. Depreciación Acumulada, que es ACTIVO pero
// tiene naturaleza ACREEDOR, o Devoluciones sobre Ventas, que es INGRESO pero
// DEUDOR) tienen una naturaleza opuesta a la de su categoría.
export type { Naturaleza };

// Naturaleza por defecto derivada de la categoría — válida para toda cuenta
// que NO sea regularizadora. ACTIVO/EGRESO → DEUDOR; resto → ACREEDOR.
export function naturalezaPorDefecto(categoria: CuentaCategoria): Naturaleza {
  return categoria === "ACTIVO" || categoria === "EGRESO" ? "DEUDOR" : "ACREEDOR";
}

// Saldo natural: valor positivo representa el saldo en la naturaleza de la
// cuenta. Usa la naturaleza explícita, no la categoría, para soportar
// regularizadoras correctamente.
export function saldoNatural(naturaleza: Naturaleza, debe: Decimal, haber: Decimal): Decimal {
  return naturaleza === "DEUDOR" ? debe.minus(haber) : haber.minus(debe);
}
