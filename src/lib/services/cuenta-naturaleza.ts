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

// Naturaleza EFECTIVA para signar saldos. DEUDOR/ACREEDOR mandan tal cual; las
// cuentas mixtas o de cierre (MIXTA / SISTEMA_VARIABLE) y las que no declaran
// naturaleza resuelven por el defecto de su categoría. Esto evita que un
// resultado mixto (clases 8/9, categoría EGRESO) se signe como acreedor e
// invierta su aporte al resultado del ejercicio; el PN de cierre (3.4) toma el
// signo acreedor correcto.
export function naturalezaEfectiva(
  naturaleza: Naturaleza | null | undefined,
  categoria: CuentaCategoria,
): Naturaleza {
  return naturaleza === "DEUDOR" || naturaleza === "ACREEDOR"
    ? naturaleza
    : naturalezaPorDefecto(categoria);
}

// Saldo natural: valor positivo representa el saldo en la naturaleza de la
// cuenta. Usa la naturaleza explícita, no la categoría, para soportar
// regularizadoras correctamente.
export function saldoNatural(naturaleza: Naturaleza, debe: Decimal, haber: Decimal): Decimal {
  return naturaleza === "DEUDOR" ? debe.minus(haber) : haber.minus(debe);
}
