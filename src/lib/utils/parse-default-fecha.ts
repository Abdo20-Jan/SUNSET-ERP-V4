/**
 * Convierte el string `defaultFecha` (yyyy-mm-dd) que viene del servidor
 * en un Date a medianoche LOCAL del cliente. Evita el bug de hidratación:
 * `new Date("2026-05-07")` parsea como UTC midnight, lo que en Argentina
 * (UTC-3) renderiza como "06/05/2026" en el cliente y "07/05/2026" en el
 * server, rompiendo SSR/hydration y dejando el DatePicker preso a re-mount
 * (calendar onSelect nunca dispara).
 *
 * Reglas:
 * - `undefined`           → `new Date()` (hoy local).
 * - `""`                  → `undefined` (modo retroactivo: el user tiene que llenar).
 * - `"yyyy-mm-dd"`        → `new Date(y, m-1, d)` (medianoche local del día).
 * - cualquier otra cosa   → `undefined` (defensivo).
 */
export function parseDefaultFecha(defaultFecha: string | undefined): Date | undefined {
  if (defaultFecha === undefined) return new Date();
  if (defaultFecha === "") return undefined;
  const match = defaultFecha.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  return new Date(y, m - 1, d);
}
