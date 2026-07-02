import "server-only";

import {
  type CuentasACobrar,
  getCuentasACobrar,
  getSaldosPorClienteConAging,
  type SaldoClienteAging,
} from "@/lib/services/cuentas-a-cobrar";

/**
 * Proyección read-only de la worklist de cuentas a cobrar (TES-03 · PR-025c).
 *
 * ADITIVA: no toca `services/cuentas-a-cobrar.ts` — el motor de aging/FIFO
 * (`getSaldosPorClienteConAging`) y el saldo contable (`getCuentasACobrar`)
 * sólo se LLAMAN, nunca se reescriben. El gate `VER_SALDO` es **no-call**
 * server-side (espejo de `saldos-proveedores-worklist.ts`/PR-025b): sin
 * permiso los motores NO se invocan y el resultado es `null` — la página
 * omite la superficie entera (toda la página son agregados de saldo: aging,
 * KPIs, per-venta y valores a cobrar). La máscara FE es sólo reflejo. El
 * boolean llega PRE-resuelto del caller (`puedeVerSaldo()` en la page) —
 * este módulo nunca importa permisos/auth.
 */
export type CuentasACobrarWorklistData = {
  /** Filas del grid: aging por cliente con ventas pendientes anidadas. */
  clientes: SaldoClienteAging[];
  /** Saldos contables por cuenta (KPI total + sección valores a cobrar). */
  cuentas: CuentasACobrar;
};

export async function listarCuentasACobrarWorklist(
  verSaldo: boolean,
): Promise<CuentasACobrarWorklistData | null> {
  if (!verSaldo) return null;
  const [cuentas, clientes] = await Promise.all([
    getCuentasACobrar(),
    getSaldosPorClienteConAging(),
  ]);
  return { clientes, cuentas };
}
