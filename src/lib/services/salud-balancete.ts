import type { Decimal } from "@/lib/decimal";
import type { CuentaCategoria, CuentaTipo, Naturaleza } from "@/generated/prisma/client";
import { naturalezaPorDefecto, saldoNatural } from "./cuenta-naturaleza";

// Guard de salud del balancete (control preventivo).
//
// Detecta cuentas ANALITICAS con saldo de signo INVERTIDO respecto de su
// naturaleza — el patrón de las anomalías de producción (cuenta de ACTIVO con
// saldo acreedor = "pasivo disfrazado de activo", causado por etapas-puente que
// nunca corrieron). Función pura, sin DB, para testearse y reusarse en un check
// de CI/cron y en los scripts de diagnóstico.
//
// Dos exclusiones (NO son anomalías):
//  1. Regularizadoras: ya quedan cubiertas por la `naturaleza` — una contra-
//     cuenta (p. ej. Depreciación Acumulada, ACTIVO/ACREEDOR) con saldo acreedor
//     tiene saldo natural POSITIVO, así que no se marca.
//  2. Subledger comercial reclasificable por signo (saldos a favor / anticipos):
//     proveedores (2.1.1./2.1.8.) con saldo deudor y clientes (1.1.3.) con saldo
//     acreedor → el Balance General los reclasifica al lado opuesto. Mismos
//     prefijos que `reclasificarSaldosAFavor` en reportes/balance-general.ts
//     (fuente canónica; duplicados acá porque ese módulo es server-only).

const RUBRO_PROVEEDORES = ["2.1.1.", "2.1.8."];
const RUBRO_CLIENTES = ["1.1.3."];

export type CuentaSaldo = {
  codigo: string;
  categoria: CuentaCategoria;
  naturaleza: Naturaleza | null;
  tipo: CuentaTipo;
  debe: Decimal;
  haber: Decimal;
};

export type AnomaliaBalancete = {
  codigo: string;
  categoria: CuentaCategoria;
  saldo: string;
  motivo: string;
};

function tieneAlgunPrefijo(codigo: string, prefijos: string[]): boolean {
  return prefijos.some((p) => codigo.startsWith(p));
}

/**
 * Devuelve las cuentas analíticas cuyo saldo natural es negativo (invertido) y
 * que NO corresponden a un saldo a favor comercial reclasificable. Lista vacía
 * = balancete sano (sin pasivos disfrazados de activos ni viceversa).
 */
export function detectarAnomaliasBalancete(cuentas: CuentaSaldo[]): AnomaliaBalancete[] {
  const anomalias: AnomaliaBalancete[] = [];

  for (const c of cuentas) {
    if (c.tipo !== "ANALITICA") continue;

    const nat = c.naturaleza ?? naturalezaPorDefecto(c.categoria);
    const saldo = saldoNatural(nat, c.debe, c.haber);
    if (!saldo.isNegative() || saldo.isZero()) continue; // saldo en su naturaleza → sano

    // Saldo a favor comercial (reclasificable por el Balance) → no es anomalía.
    const esProveedorAFavor =
      c.categoria === "PASIVO" && tieneAlgunPrefijo(c.codigo, RUBRO_PROVEEDORES);
    const esClienteAFavor = c.categoria === "ACTIVO" && tieneAlgunPrefijo(c.codigo, RUBRO_CLIENTES);
    if (esProveedorAFavor || esClienteAFavor) continue;

    anomalias.push({
      codigo: c.codigo,
      categoria: c.categoria,
      saldo: saldo.toFixed(2),
      motivo:
        c.categoria === "ACTIVO"
          ? "ACTIVO con saldo acreedor (pasivo disfrazado de activo)"
          : c.categoria === "PASIVO"
            ? "PASIVO con saldo deudor (no reclasificable como saldo a favor)"
            : `${c.categoria} con saldo de signo invertido`,
    });
  }

  return anomalias;
}
