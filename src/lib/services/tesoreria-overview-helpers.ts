import { sumMoney } from "@/lib/decimal";

/**
 * Saldo de préstamos partido por moneda nativa. Los préstamos USD-natos
 * (saldoPendienteUsd != null) aportan su saldo USD invariante a TC; los
 * préstamos en ARS aportan su saldo ARS. La presentación convierte cada
 * parte native-aware al TC de cierre (mismo patrón que saldoBancosCaja).
 */
export type SaldoPrestamos = { ars: string; usd: string };

/** Shape mínimo de un préstamo para la agregación (subset de PrestamoRow). */
export type PrestamoSaldoLike = {
  saldoPendiente: string;
  saldoPendienteUsd: string | null;
};

/**
 * Agrega el saldo pendiente de los préstamos por moneda nativa.
 * Función pura → testeable sin DB (sin imports de acciones/server-only).
 *
 * Un préstamo es USD-nato cuando `saldoPendienteUsd` no es null (el principal
 * en USD es invariante al TC). En ese caso su saldo cuenta como USD. Si es
 * null, el préstamo es ARS y su `saldoPendiente` (ARS) cuenta como ARS.
 */
export function agregarSaldoPrestamos(prestamos: readonly PrestamoSaldoLike[]): SaldoPrestamos {
  const ars = sumMoney(
    prestamos.filter((p) => p.saldoPendienteUsd == null).map((p) => p.saldoPendiente),
  );
  const usd = sumMoney(
    prestamos.filter((p) => p.saldoPendienteUsd != null).map((p) => p.saldoPendienteUsd as string),
  );
  return { ars: ars.toFixed(2), usd: usd.toFixed(2) };
}
