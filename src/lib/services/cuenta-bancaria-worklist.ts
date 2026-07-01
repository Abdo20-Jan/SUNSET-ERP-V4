import "server-only";

import { Moneda, Prisma, TipoCuentaBancaria } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { calcularSaldosCuentasBancariasEnMonedaCuenta } from "@/lib/services/cuenta-bancaria";

/**
 * Proyección read-only de la worklist de cuentas bancarias (TES-01 · PR-025a).
 *
 * ADITIVA: no toca `actions/cuentas-bancarias.ts` ni el motor de saldo
 * (`calcularSaldosCuentasBancariasEnMonedaCuenta` sólo se LLAMA, nunca se
 * reescribe). El gate `VER_SALDO` es **narrow-select** server-side (espejo de
 * CX-02/CX-04): sin permiso NO se calcula ni viaja el saldo — el campo queda
 * `null` (server omite, no "—"). La máscara FE es sólo reflejo.
 */
export type CuentaBancariaWorklistRow = {
  id: string;
  banco: string;
  tipo: TipoCuentaBancaria;
  moneda: Moneda;
  numero: string | null;
  cbu: string | null;
  alias: string | null;
  cuentaContableCodigo: string;
  cuentaContableNombre: string;
  /** Saldo en moneda de la cuenta. `null` cuando el caller no tiene `VER_SALDO`. */
  saldo: string | null;
};

export async function listarCuentasBancariasWorklist(
  verSaldo: boolean,
): Promise<CuentaBancariaWorklistRow[]> {
  const cuentas = await db.cuentaBancaria.findMany({
    orderBy: [{ banco: "asc" }, { moneda: "asc" }],
    select: {
      id: true,
      banco: true,
      tipo: true,
      moneda: true,
      numero: true,
      cbu: true,
      alias: true,
      cuentaContable: { select: { id: true, codigo: true, nombre: true } },
    },
  });

  // Sin permiso NO se calcula el saldo (no se toca el motor): el valor nunca
  // llega al cliente. Con permiso, se lee del servicio existente (nunca recomputa).
  const saldos = verSaldo
    ? await calcularSaldosCuentasBancariasEnMonedaCuenta(
        cuentas.map((c) => ({ cuentaContableId: c.cuentaContable.id, moneda: c.moneda })),
      )
    : null;

  return cuentas.map((c) => ({
    id: c.id,
    banco: c.banco,
    tipo: c.tipo,
    moneda: c.moneda,
    numero: c.numero,
    cbu: c.cbu,
    alias: c.alias,
    cuentaContableCodigo: c.cuentaContable.codigo,
    cuentaContableNombre: c.cuentaContable.nombre,
    saldo: saldos ? (saldos.get(c.cuentaContable.id) ?? new Prisma.Decimal(0)).toFixed(2) : null,
  }));
}
