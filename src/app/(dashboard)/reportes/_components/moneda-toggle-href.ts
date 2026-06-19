import type { Moneda } from "./moneda-toggle";

/**
 * Construye el href del MonedaToggle seteando la moneda de presentación en el
 * query param indicado (`param`, por default `"moneda"`). Función pura (sin
 * React) para poder testear sin RTL.
 *
 * Pantallas que ya usan `?moneda=` como FILTRO de datos (préstamos,
 * pagos-historial) pasan `param="pres"` para no pisar ese filtro: el toggle
 * controla la presentación en `pres` y el filtro `moneda` queda intacto.
 */
export function buildMonedaHref(
  pathname: string,
  searchParams: string,
  moneda: Moneda,
  param = "moneda",
): string {
  const next = new URLSearchParams(searchParams);
  // Setear siempre explícito: la ausencia del param se interpreta como
  // "preferencia del usuario" (USD por default), entonces elegir ARS lo deja
  // explícito y volver a USD lo refleja.
  next.set(param, moneda);
  return `${pathname}?${next.toString()}`;
}
