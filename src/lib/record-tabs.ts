// Resuelve el tab activo de un record-shell a partir del search param `tab`,
// validándolo contra la allowlist de tabs (cae al fallback si es desconocido o
// ausente). Puro → testeable en vitest node. Espeja el patrón de table-sort.ts.
export function resolveActiveTab(
  param: string | undefined,
  allowed: readonly string[],
  fallback: string,
): string {
  return param && allowed.includes(param) ? param : fallback;
}
