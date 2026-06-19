// Diff puro entre dos snapshots de auditoría (datosAnteriores/datosNuevos del
// AuditLog). Devuelve sólo los campos que cambiaron. Tratando null como {}, el
// mismo algoritmo cubre CREATE (anteriores null → altas), UPDATE (sólo
// cambios) y DELETE (nuevos null → bajas). Testeado en vitest node.

export type CampoDiff = { campo: string; antes: string | null; despues: string | null };

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function fmt(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

export function diffAuditoria(anteriores: unknown, nuevos: unknown): CampoDiff[] {
  const a = asRecord(anteriores);
  const n = asRecord(nuevos);

  // Unión de claves preservando el orden: primero las de `antes`, luego las
  // nuevas que no estaban.
  const claves = [...Object.keys(a), ...Object.keys(n).filter((k) => !(k in a))];

  const diffs: CampoDiff[] = [];
  for (const campo of claves) {
    const antes = fmt(a[campo]);
    const despues = fmt(n[campo]);
    if (antes !== despues) diffs.push({ campo, antes, despues });
  }
  return diffs;
}
