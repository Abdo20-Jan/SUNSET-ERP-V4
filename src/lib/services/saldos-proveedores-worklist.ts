import "server-only";

import {
  getSaldosPorProveedorConAging,
  type SaldoProveedorAging,
} from "@/lib/services/cuentas-a-pagar";

/**
 * Proyección read-only de la worklist de saldos por proveedor (TES-02 · PR-025b).
 *
 * ADITIVA: no toca `services/cuentas-a-pagar.ts` — el motor de aging
 * (`getSaldosPorProveedorConAging`, 5 capas de reconstrucción de pagos) sólo se
 * LLAMA, nunca se reescribe. El gate `VER_SALDO` es **no-call** server-side
 * (espejo de `cuenta-bancaria-worklist.ts`/PR-025a): sin permiso el motor NO se
 * invoca y el resultado es `null` — la página omite la superficie entera (toda
 * la página es agregados de saldo y el batch-pago es saldo-driven). La máscara
 * FE es sólo reflejo. El boolean llega PRE-resuelto del caller
 * (`puedeVerSaldo()` en la page) — este módulo nunca importa permisos/auth.
 */
export async function listarSaldosProveedoresWorklist(
  verSaldo: boolean,
): Promise<SaldoProveedorAging[] | null> {
  if (!verSaldo) return null;
  return getSaldosPorProveedorConAging();
}
