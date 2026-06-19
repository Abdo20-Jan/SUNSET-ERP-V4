import "server-only";

import Decimal from "decimal.js";

import { db } from "@/lib/db";
import { getKpisPrincipales } from "@/lib/services/dashboard";
import { PeriodoEstado } from "@/generated/prisma/client";

export type ResumenContabilidad = {
  /** Asientos en estado CONTABILIZADO (conteo acumulado). */
  asientosContabilizados: number;
  /** Resultado del ejercicio en ARS (Ingresos − Egresos, histórico). */
  resultadoEjercicioArs: Decimal;
  /** Total Pasivo en ARS (categoría PASIVO del ledger contabilizado). */
  totalPasivoArs: Decimal;
  /** Períodos contables en estado ABIERTO. */
  periodosAbiertos: number;
};

/**
 * KPIs del overview de Contabilidad. Service thin: los tres KPIs monetarios y
 * el conteo de asientos salen directos de `getKpisPrincipales` (misma fuente
 * que el dashboard, reconciliada con el ledger); el 4º KPI es un conteo simple
 * de períodos abiertos. No hay lógica de agregación pura → sin helper/test.
 */
export async function getResumenContabilidad(): Promise<ResumenContabilidad> {
  const [kpis, periodosAbiertos] = await Promise.all([
    getKpisPrincipales(),
    db.periodoContable.count({ where: { estado: PeriodoEstado.ABIERTO } }),
  ]);

  return {
    asientosContabilizados: kpis.asientosContabilizados,
    resultadoEjercicioArs: kpis.resultadoEjercicio,
    totalPasivoArs: kpis.totalPasivo,
    periodosAbiertos,
  };
}
