// Coeficiente de reexpresión (deflactor / inflactor) entre dos índices de precios.
//
// Módulo PURO: sin `server-only`, sin Prisma/DB. Es la base del RECPAM (hoy
// apagado) y de la deflación de series temporales (ventas reales a la Lynch).
// NO tiene efecto en ningún reporte — es sólo infraestructura de dato.

/** Mapa periodo (YYYY-MM) → valor del índice de precios. */
export type SerieIndice = ReadonlyMap<string, number>;

/**
 * Coeficiente de reexpresión origen→cierre = `idxCierre / idxOrigen`: cuánto hay
 * que multiplicar un monto del período origen para expresarlo en moneda de cierre.
 *
 * Zero-safe / defensivo: si `idxOrigen <= 0` o algún argumento es `NaN`, devuelve
 * `1` (neutro, sin ajuste) en lugar de propagar `Infinity`/`NaN` — misma
 * convención defensiva que los ratios de `bi-giro-formulas.ts`.
 */
export function coeficiente(idxOrigen: number, idxCierre: number): number {
  if (Number.isNaN(idxOrigen) || Number.isNaN(idxCierre) || idxOrigen <= 0) return 1;
  return idxCierre / idxOrigen;
}

/**
 * Coeficiente entre dos períodos de una serie ya cargada (mapa periodo→índice).
 * Si falta alguno de los períodos, devuelve `1` (neutro). Sigue puro: no toca DB.
 */
export function coeficienteEntrePeriodos(
  serie: SerieIndice,
  periodoOrigen: string,
  periodoCierre: string,
): number {
  const origen = serie.get(periodoOrigen);
  const cierre = serie.get(periodoCierre);
  if (origen === undefined || cierre === undefined) return 1;
  return coeficiente(origen, cierre);
}
