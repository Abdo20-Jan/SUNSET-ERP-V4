import "server-only";

import { toDecimal } from "@/lib/decimal";
import { AsientoEstado, CuentaTipo } from "@/generated/prisma/client";
import { db } from "@/lib/db";

import { calcularLiquidez, type LiquidezIndicadores } from "./bi-liquidez-formulas";

// Prefijos del plan de 9 clases (ver orden-eecc.ts / BALANCE_RUBROS):
// 1.1.* = Activo corriente · 2.1.* = Pasivo corriente · 1.1.7.* = Bienes de
// cambio · 1.1.1.* = Caja y bancos.
const PREFIJO_ACTIVO_CORRIENTE = "1.1.";
const PREFIJO_PASIVO_CORRIENTE = "2.1.";
const PREFIJO_INVENTARIO = "1.1.7.";
const PREFIJO_DISPONIBILIDADES = "1.1.1.";

type Naturaleza = "deudor" | "acreedor";

/** Saldo acumulado (a la fecha) de las cuentas analíticas bajo un prefijo, en ARS. */
async function saldoPorPrefijo(prefijo: string, naturaleza: Naturaleza): Promise<number> {
  const agg = await db.lineaAsiento.aggregate({
    where: {
      asiento: { estado: AsientoEstado.CONTABILIZADO },
      cuenta: { tipo: CuentaTipo.ANALITICA, codigo: { startsWith: prefijo } },
    },
    _sum: { debe: true, haber: true },
  });
  const debe = toDecimal(agg._sum.debe ?? 0);
  const haber = toDecimal(agg._sum.haber ?? 0);
  return (naturaleza === "deudor" ? debe.minus(haber) : haber.minus(debe)).toNumber();
}

export type AnalisisLiquidez = {
  indicadores: LiquidezIndicadores;
  inputs: {
    activoCorriente: number;
    pasivoCorriente: number;
    inventario: number;
    disponibilidades: number;
  };
};

/**
 * Indicadores de liquidez (solvencia de corto plazo). Es una foto a la fecha:
 * saldos acumulados del libro mayor en ARS, todos del mismo origen → ratios
 * internamente consistentes. Sin rango de fechas (no hay flujos), sin schema.
 */
export async function getAnalisisLiquidez(): Promise<AnalisisLiquidez> {
  const [activoCorriente, pasivoCorriente, inventario, disponibilidades] = await Promise.all([
    saldoPorPrefijo(PREFIJO_ACTIVO_CORRIENTE, "deudor"),
    saldoPorPrefijo(PREFIJO_PASIVO_CORRIENTE, "acreedor"),
    saldoPorPrefijo(PREFIJO_INVENTARIO, "deudor"),
    saldoPorPrefijo(PREFIJO_DISPONIBILIDADES, "deudor"),
  ]);
  const inputs = { activoCorriente, pasivoCorriente, inventario, disponibilidades };
  return { indicadores: calcularLiquidez(inputs), inputs };
}
