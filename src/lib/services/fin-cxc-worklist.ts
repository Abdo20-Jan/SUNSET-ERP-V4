import "server-only";

import {
  getSaldosPorClienteConAging,
  type SaldoClienteAging,
} from "@/lib/services/cuentas-a-cobrar";

/**
 * Proyección read-only de la worklist de gestión de cuentas a cobrar
 * (FIN-01 · PR-026).
 *
 * ADITIVA: no toca `services/cuentas-a-cobrar.ts` — el motor de aging/FIFO
 * (`getSaldosPorClienteConAging`) sólo se LLAMA, nunca se reescribe. NO reusa
 * `listarCuentasACobrarWorklist` (025c) porque esa proyección también dispara
 * `getCuentasACobrar()` (saldos por cuenta + valores a cobrar), que la vista
 * de gestión per-documento no consume. El gate `VER_SALDO` es **no-call**
 * server-side (espejo de `saldos-proveedores-worklist.ts`/PR-025b): sin
 * permiso el motor NO se invoca y el resultado es `null` — la página omite la
 * superficie entera (toda la página son agregados de saldo). La máscara FE es
 * sólo reflejo. El boolean llega PRE-resuelto del caller (`puedeVerSaldo()`
 * en la page) — este módulo nunca importa permisos/auth.
 */
export async function listarFinCxcWorklist(verSaldo: boolean): Promise<SaldoClienteAging[] | null> {
  if (!verSaldo) return null;
  return getSaldosPorClienteConAging();
}
