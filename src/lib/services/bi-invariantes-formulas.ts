import { eqMoney, type Decimal } from "@/lib/decimal";

// Guard de invariante contable — partida doble (control preventivo del BI).
//
// La primera invariante de un libro diario sano: por cada asiento, Σdebe == Σhaber.
// Esta es la versión PURA (sin DB, sin `server-only`): recibe los asientos ya
// agregados en memoria y devuelve las violaciones (lista vacía = ledger cuadrado).
// Imita el estilo de `salud-balancete.ts` y se deja reusar por un card de calidad
// del BI y por tests/CI.
//
// NO sustituye al guard de producción (`prisma/validar-invariantes-asiento.ts`,
// que corre contra la DB en el cron/CI): esto es la capa pura/in-memory, testeable
// sin banco, para el job `test` del CI y para reuso futuro en la UI.

export type AsientoBalance = {
  /** Número del asiento — identifica la violación. */
  numero: number;
  totalDebe: Decimal;
  totalHaber: Decimal;
};

export type ViolacionPartidaDoble = {
  numero: number;
  totalDebe: string;
  totalHaber: string;
  /** totalDebe − totalHaber, con signo, a 2 decimales. */
  diferencia: string;
};

/**
 * Devuelve los asientos que violan la partida doble (Σdebe ≠ Σhaber). Lista
 * vacía = ledger cuadrado.
 *
 * La igualdad se evalúa con `eqMoney` (Decimal `.eq()` redondeado a 2 decimales,
 * la escala monetaria) — NUNCA `===` (compararía referencias de objeto Decimal,
 * siempre distintas) ni resta-y-`isZero` sin control de escala.
 */
export function detectarAsientosDescuadrados(asientos: AsientoBalance[]): ViolacionPartidaDoble[] {
  const violaciones: ViolacionPartidaDoble[] = [];
  for (const a of asientos) {
    if (eqMoney(a.totalDebe, a.totalHaber)) continue;
    violaciones.push({
      numero: a.numero,
      totalDebe: a.totalDebe.toFixed(2),
      totalHaber: a.totalHaber.toFixed(2),
      diferencia: a.totalDebe.minus(a.totalHaber).toFixed(2),
    });
  }
  return violaciones;
}
