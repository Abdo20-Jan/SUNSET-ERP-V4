// Helpers puros del cierre del ejercicio (sin "server-only": testeables y
// consumibles por el componente cliente del diálogo).

export type PeriodoRango = { fechaInicio: Date; fechaFin: Date };

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Rango por defecto del ejercicio para el diálogo de cierre: la menor
 * `fechaInicio` y la mayor `fechaFin` de los períodos dados, en formato
 * YYYY-MM-DD. Sin períodos → strings vacíos.
 */
export function rangoEjercicioPorDefecto(periodos: readonly PeriodoRango[]): {
  desde: string;
  hasta: string;
} {
  if (periodos.length === 0) return { desde: "", hasta: "" };
  let min = periodos[0].fechaInicio;
  let max = periodos[0].fechaFin;
  for (const p of periodos) {
    if (p.fechaInicio < min) min = p.fechaInicio;
    if (p.fechaFin > max) max = p.fechaFin;
  }
  return { desde: ymd(min), hasta: ymd(max) };
}

/**
 * Rango válido para el cierre: ambas fechas presentes y desde ≤ hasta. La
 * comparación lexicográfica de YYYY-MM-DD coincide con la cronológica.
 */
export function esRangoEjercicioValido(desde: string, hasta: string): boolean {
  if (!desde || !hasta) return false;
  return desde <= hasta;
}
