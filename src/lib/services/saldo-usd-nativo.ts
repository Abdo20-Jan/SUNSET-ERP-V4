import "server-only";

import { db } from "@/lib/db";
import { toDecimal } from "@/lib/decimal";
import { AsientoEstado, Moneda } from "@/generated/prisma/client";

// ============================================================
// Saldo USD-nativo por cuenta contable.
//
// Suma el NETO de las líneas de asiento con monedaOrigen=USD (montoOrigen es
// el principal histórico en USD, invariante a TC). Es el mecanismo canónico
// para saber "cuánto de este saldo contable es nativo-USD" — espelha el cálculo
// que cuentas-a-pagar.ts ya hace inline para getCuentasAPagar (3 groupBy:
// lista / debe / haber, neteados).
//
//   lado="deudor"   → cuentas de ACTIVO (clientes 1.1.3.x): neto = DEBE − HABER
//   lado="acreedor" → cuentas de PASIVO (proveedores): neto = HABER − DEBE
//
// Sólo devuelve cuentas con saldo USD > 0.005 (filtra ruido de redondeo). Las
// cuentas sin ninguna línea USD-nata no aparecen en el Map → el call-site cae
// en el saldo ARS (pickSaldoNativo).
// ============================================================
export async function getSaldoUsdNativoPorCuenta(
  cuentaIds: number[],
  lado: "deudor" | "acreedor",
): Promise<Map<number, string>> {
  if (cuentaIds.length === 0) return new Map();

  const baseWhere = {
    cuentaId: { in: cuentaIds },
    monedaOrigen: Moneda.USD,
    asiento: { estado: AsientoEstado.CONTABILIZADO },
  } as const;

  const [lista, debe, haber] = await Promise.all([
    db.lineaAsiento.groupBy({ by: ["cuentaId"], where: baseWhere, _sum: { montoOrigen: true } }),
    db.lineaAsiento.groupBy({
      by: ["cuentaId"],
      where: { ...baseWhere, debe: { gt: 0 } },
      _sum: { montoOrigen: true },
    }),
    db.lineaAsiento.groupBy({
      by: ["cuentaId"],
      where: { ...baseWhere, haber: { gt: 0 } },
      _sum: { montoOrigen: true },
    }),
  ]);

  const debePorCuenta = new Map<number, ReturnType<typeof toDecimal>>(
    debe.map((s) => [s.cuentaId, toDecimal(s._sum.montoOrigen ?? 0)]),
  );
  const haberPorCuenta = new Map<number, ReturnType<typeof toDecimal>>(
    haber.map((s) => [s.cuentaId, toDecimal(s._sum.montoOrigen ?? 0)]),
  );

  const out = new Map<number, string>();
  for (const c of lista) {
    const d = debePorCuenta.get(c.cuentaId) ?? toDecimal(0);
    const h = haberPorCuenta.get(c.cuentaId) ?? toDecimal(0);
    const saldo = lado === "deudor" ? d.minus(h) : h.minus(d);
    if (saldo.gt(0.005)) out.set(c.cuentaId, saldo.toFixed(2));
  }
  return out;
}
