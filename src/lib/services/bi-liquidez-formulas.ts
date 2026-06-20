/**
 * Fórmulas PURAS de liquidez (solvencia de corto plazo). Sin acceso a la base
 * ni a `server-only`: testeables de forma aislada.
 *
 * Bases (decisiones del recorte): todos los saldos son del libro mayor en
 * moneda base (ARS), acumulados a la fecha, para que el ratio sea internamente
 * consistente:
 * - Activo corriente  = saldo de cuentas 1.1.* (deudor).
 * - Pasivo corriente  = saldo de cuentas 2.1.* (acreedor).
 * - Inventario        = saldo de bienes de cambio 1.1.7.* (deudor).
 * - Disponibilidades  = saldo de caja y bancos 1.1.1.* (deudor).
 */

export type LiquidezInputs = {
  activoCorriente: number;
  pasivoCorriente: number;
  inventario: number;
  disponibilidades: number;
};

export type LiquidezIndicadores = {
  /** Razón corriente = Activo corriente ÷ Pasivo corriente. */
  razonCorriente: number;
  /** Prueba ácida = (Activo corriente − Inventario) ÷ Pasivo corriente. */
  pruebaAcida: number;
  /** Liquidez inmediata = Disponibilidades ÷ Pasivo corriente. */
  liquidezInmediata: number;
  /** Capital de trabajo neto = Activo corriente − Pasivo corriente (monto). */
  capitalTrabajo: number;
};

/** Ratio zero-safe: si el denominador no es positivo devuelve 0. */
function ratio(numerador: number, denominador: number): number {
  if (denominador <= 0) return 0;
  return numerador / denominador;
}

export function calcularLiquidez(i: LiquidezInputs): LiquidezIndicadores {
  return {
    razonCorriente: ratio(i.activoCorriente, i.pasivoCorriente),
    pruebaAcida: ratio(i.activoCorriente - i.inventario, i.pasivoCorriente),
    liquidezInmediata: ratio(i.disponibilidades, i.pasivoCorriente),
    capitalTrabajo: i.activoCorriente - i.pasivoCorriente,
  };
}
