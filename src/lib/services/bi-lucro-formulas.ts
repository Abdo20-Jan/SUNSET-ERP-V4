/**
 * Fórmulas PURAS de lucro / rentabilidad (familia MAR). Sin acceso a la base ni
 * a `server-only`: testeables de forma aislada.
 *
 * Fuente de los insumos (los provee el service desde la cascada RT9 del razón —
 * verdad contable, ver `reportes/estado-resultados-rt9.ts`):
 * - `resultadoBruto` = Ingresos netos − Costo de ventas (subtotal RESULTADO_BRUTO).
 * - `ebit` (Resultado operativo) = Resultado bruto − Gastos de comercialización
 *   − Gastos de administración − Otros gastos operativos (la cascada no emite un
 *   subtotal operativo, así que el service lo suma de esos conceptos).
 * - `depreciacionAmortizacion` = saldo deudor del prefijo "7.7." (D&A, dentro de
 *   Gastos de administración) → se reincorpora para el EBITDA.
 * - `resultadoNeto` = Resultado del ejercicio (Σ haber − debe de toda cuenta de
 *   resultado).
 * - `ventas` = Ingresos netos (denominador de todos los márgenes %).
 *
 * Todos los márgenes % son adimensionales (TC-invariantes). Zero-safe: con
 * ventas ≤ 0 (post-wipe / sin movimientos) los % devuelven 0.
 */

export type LucroInputs = {
  /** Ingresos netos del período (denominador de los márgenes). */
  ventas: number;
  /** Resultado bruto = Ventas − CMV (cascada RT9). */
  resultadoBruto: number;
  /** Resultado operativo (EBIT): bruto − comercialización − administración − otros operativos. */
  ebit: number;
  /** Depreciación + amortización del período (saldo deudor "7.7."), para el EBITDA. */
  depreciacionAmortizacion: number;
  /** Resultado del ejercicio (cascada RT9). */
  resultadoNeto: number;
};

export type LucroIndicadores = {
  /** Resultado bruto (monto). */
  margenBruto: number;
  /** Margen bruto sobre ventas. */
  margenBrutoPct: number;
  /** Resultado operativo / EBIT (monto). */
  ebit: number;
  /** Margen operativo sobre ventas. */
  margenOperativoPct: number;
  /** EBIT + depreciación/amortización (monto). */
  ebitda: number;
  /** Margen EBITDA sobre ventas. */
  margenEbitdaPct: number;
  /** Resultado del ejercicio (monto). */
  resultadoNeto: number;
  /** Margen neto sobre ventas. */
  margenNetoPct: number;
};

/** Razón zero-safe: si el denominador no es positivo devuelve 0. */
function ratio(numerador: number, denominador: number): number {
  if (denominador <= 0) return 0;
  return numerador / denominador;
}

export function calcularLucro(i: LucroInputs): LucroIndicadores {
  const ebitda = i.ebit + i.depreciacionAmortizacion;
  return {
    margenBruto: i.resultadoBruto,
    margenBrutoPct: ratio(i.resultadoBruto, i.ventas),
    ebit: i.ebit,
    margenOperativoPct: ratio(i.ebit, i.ventas),
    ebitda,
    margenEbitdaPct: ratio(ebitda, i.ventas),
    resultadoNeto: i.resultadoNeto,
    margenNetoPct: ratio(i.resultadoNeto, i.ventas),
  };
}
