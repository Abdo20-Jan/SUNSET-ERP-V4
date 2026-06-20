import "server-only";

import { toDecimal } from "@/lib/decimal";
import { AsientoEstado, CuentaTipo } from "@/generated/prisma/client";
import { db } from "@/lib/db";

import { getResumenEjecutivo, type DateRange } from "./bi";
import { calcularGiro, diasDelPeriodo, type GiroIndicadores } from "./bi-giro-formulas";

/** Proveedores comerciales (excluye préstamos 2.1.2 / fiscales 2.1.3 / no comerciales). */
const PREFIJO_CXP_COMERCIAL = "2.1.1.";

export type AnalisisGiro = {
  indicadores: GiroIndicadores;
  /** Entradas crudas (moneda base ARS) para transparencia / tooltip. */
  inputs: {
    ventasPeriodo: number;
    cmvPeriodo: number;
    inventario: number;
    cxc: number;
    cxpComercial: number;
    diasPeriodo: number;
  };
};

/**
 * Indicadores de giro (capital de trabajo) del período.
 *
 * Reutiliza `getResumenEjecutivo` para ventas / CMV / inventario / CxC (los
 * mismos números que muestra la pestaña Resumen → reconcilia 1:1) y agrega una
 * consulta acotada del saldo de proveedores comerciales (2.1.1.*), porque el
 * `kpis.cxp` del resumen es TODO el pasivo y sobreestimaría DPO/NOF.
 *
 * Los saldos (inventario / CxC / CxP) son acumulados a la fecha, igual que en el
 * resumen; los flujos (ventas / CMV) son del período. Sin cambios de schema.
 */
export async function getAnalisisGiro(rng: DateRange): Promise<AnalisisGiro> {
  const [resumen, cxpAgg] = await Promise.all([
    getResumenEjecutivo(rng),
    db.lineaAsiento.aggregate({
      where: {
        asiento: { estado: AsientoEstado.CONTABILIZADO },
        cuenta: { tipo: CuentaTipo.ANALITICA, codigo: { startsWith: PREFIJO_CXP_COMERCIAL } },
      },
      _sum: { debe: true, haber: true },
    }),
  ]);

  const k = resumen.kpis;
  // CxP comercial: saldo acreedor = haber − debe.
  const cxpComercial = toDecimal(cxpAgg._sum.haber ?? 0)
    .minus(toDecimal(cxpAgg._sum.debe ?? 0))
    .toNumber();
  // CMV al costo recuperado del resumen: margenBruto = facturación − CMV.
  const cmvPeriodo = k.facturacionPeriodo - k.margenBruto;

  const inputs = {
    ventasPeriodo: k.facturacionPeriodo,
    cmvPeriodo,
    inventario: k.stockValorado,
    cxc: k.cxc,
    cxpComercial,
    diasPeriodo: diasDelPeriodo(rng.desde, rng.hasta),
  };

  return { indicadores: calcularGiro(inputs), inputs };
}
