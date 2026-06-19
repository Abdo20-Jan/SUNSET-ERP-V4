import "server-only";

import { listarPrestamosConSaldo } from "@/lib/actions/prestamos";
import { getCuentasACobrar } from "@/lib/services/cuentas-a-cobrar";
import { getCuentasAPagar } from "@/lib/services/cuentas-a-pagar";
import { getKpisPrincipales } from "@/lib/services/dashboard";
import {
  agregarSaldoPrestamos,
  type SaldoPrestamos,
} from "@/lib/services/tesoreria-overview-helpers";

export {
  agregarSaldoPrestamos,
  type SaldoPrestamos,
} from "@/lib/services/tesoreria-overview-helpers";

export type ResumenTesoreria = {
  /** Saldo Bancos + Caja por moneda nativa (igual a la tabla del dashboard). */
  saldoBancosCaja: { ars: string; usd: string };
  /** Total cuentas a cobrar (ARS, agregado contable). */
  cuentasACobrar: string;
  /** Total cuentas a pagar (ARS, agregado contable). */
  cuentasAPagar: string;
  /** Saldo de préstamos por moneda nativa (USD invariante a TC). */
  prestamos: SaldoPrestamos;
};

/**
 * KPIs del overview de Tesorería. Junta las fuentes ya existentes del módulo
 * (saldos bancarios, CxC, CxP, préstamos). Cada KPI conserva su moneda nativa;
 * la conversión a moneda de presentación ocurre en la página (native-aware).
 */
export async function getResumenTesoreria(): Promise<ResumenTesoreria> {
  const [kpis, cxc, cxp, prestamos] = await Promise.all([
    getKpisPrincipales(),
    getCuentasACobrar(),
    getCuentasAPagar(),
    listarPrestamosConSaldo(),
  ]);

  return {
    saldoBancosCaja: {
      ars: kpis.saldoBancosCaja.ars.toString(),
      usd: kpis.saldoBancosCaja.usd.toString(),
    },
    cuentasACobrar: cxc.totalGeneral,
    cuentasAPagar: cxp.totalGeneral,
    prestamos: agregarSaldoPrestamos(prestamos),
  };
}
