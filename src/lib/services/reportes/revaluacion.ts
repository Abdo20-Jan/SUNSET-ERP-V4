import "server-only";

import { db } from "@/lib/db";
import { Decimal, sumMoney, toDecimal } from "@/lib/decimal";
import { AsientoEstado, Moneda } from "@/generated/prisma/client";

/**
 * Revaluación (sólo presentación) de las posiciones monetarias en moneda
 * extranjera al TC de cierre. NO graba asiento: la partida mantiene su moneda
 * nativa; la diferencia se expone como línea en el Balance/ER.
 *
 * Una "posición" es cualquier cuenta patrimonial (ACTIVO/PASIVO/PATRIMONIO) con
 * líneas en USD (`monedaOrigen='USD'`), lo que incluye estoque BI (decisión del
 * dueño 2026-06-17). En términos brutos deudores (debe−haber), por cuenta:
 *   usdBruto    = Σ montoOrigen (lado debe) − Σ montoOrigen (lado haber)
 *   arsBrutoUsd = Σ (debe − haber) de las líneas USD
 *   revBruta    = usdBruto × TC_cierre − arsBrutoUsd
 * `revBruta > 0` en una cuenta deudora (activo) = ganancia; en una acreedora
 * (pasivo) la suba del valor en ARS = pérdida (el signo lo aplica el caller con
 * la naturaleza). `total = Σ revBruta` = efecto neto en el resultado del
 * ejercicio (positivo = ganancia 4.3.1.02 / negativo = pérdida 5.8.1.02).
 *
 * Acumulado hasta `hasta` (foto al cierre). Sin fallback legado: pos-wipe el
 * ledger sólo tiene `monedaOrigen=USD` canónico; líneas legadas no se revalúan.
 */
export type RevaluacionUsd = {
  /** cuentaId → revBruta (ARS, términos deudores, redondeada a 2). */
  porCuenta: Map<number, Decimal>;
  /** Σ revBruta = efecto en el resultado del ejercicio (positivo = ganancia). */
  total: Decimal;
  /** Hubo líneas USD en posiciones (haya o no TC). Si true y no hay TC, el
   * caller debe advertir que las posiciones no se revaluaron. */
  hayPosiciones: boolean;
};

export async function calcularRevaluacionUsd(
  hasta: Date | undefined,
  tcCierre: Decimal | null,
): Promise<RevaluacionUsd> {
  const lineas = await db.lineaAsiento.findMany({
    where: {
      monedaOrigen: Moneda.USD,
      asiento: {
        estado: AsientoEstado.CONTABILIZADO,
        ...(hasta ? { fecha: { lte: hasta } } : {}),
      },
      cuenta: { categoria: { in: ["ACTIVO", "PASIVO", "PATRIMONIO"] } },
    },
    select: { cuentaId: true, debe: true, haber: true, montoOrigen: true },
  });

  const hayPosiciones = lineas.length > 0;
  // Sin TC no se revalúa; el caller advierte si hayPosiciones.
  if (tcCierre === null) return { porCuenta: new Map(), total: new Decimal(0), hayPosiciones };

  const usdBrutoPorCuenta = new Map<number, Decimal>();
  const arsBrutoPorCuenta = new Map<number, Decimal>();
  for (const l of lineas) {
    const debe = toDecimal(l.debe);
    const haber = toDecimal(l.haber);
    const usd = l.montoOrigen ? toDecimal(l.montoOrigen) : new Decimal(0);
    // montoOrigen es el principal (sin signo); el lado (debe/haber) da el signo.
    const usdSign = debe.gt(0) ? usd : haber.gt(0) ? usd.negated() : new Decimal(0);
    usdBrutoPorCuenta.set(
      l.cuentaId,
      (usdBrutoPorCuenta.get(l.cuentaId) ?? new Decimal(0)).plus(usdSign),
    );
    arsBrutoPorCuenta.set(
      l.cuentaId,
      (arsBrutoPorCuenta.get(l.cuentaId) ?? new Decimal(0)).plus(debe.minus(haber)),
    );
  }

  const porCuenta = new Map<number, Decimal>();
  for (const [cuentaId, usdBruto] of usdBrutoPorCuenta) {
    const arsBruto = arsBrutoPorCuenta.get(cuentaId) ?? new Decimal(0);
    const revBruta = usdBruto.times(tcCierre).minus(arsBruto).toDecimalPlaces(2);
    porCuenta.set(cuentaId, revBruta);
  }

  const total = sumMoney([...porCuenta.values()]);
  return { porCuenta, total, hayPosiciones };
}
