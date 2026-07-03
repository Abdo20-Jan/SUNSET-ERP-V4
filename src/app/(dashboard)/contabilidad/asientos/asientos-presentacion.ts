/**
 * Helpers puros client-safe de la worklist de asientos (CONT-01 · PR-028).
 * Espejo estructural de `fin-cxc-presentacion.ts` (PR-026): sin Prisma, sin
 * auth, sin efectos — sólo tipos y funciones puras testables. Las vistas
 * oficiales son presets `?vista=` server-side (lección PR-010); el `where`
 * Prisma correspondiente vive en `src/lib/services/asientos-worklist.ts`.
 */

export const ASIENTOS_VISTA_IDS = [
  "todos",
  "manuales",
  "automaticos",
  "comex",
  "ajustes",
  "anulados",
] as const;

export type AsientosVista = (typeof ASIENTOS_VISTA_IDS)[number];

export const ASIENTOS_VISTAS: ReadonlyArray<{ id: AsientosVista; label: string }> = [
  { id: "todos", label: "Todos" },
  { id: "manuales", label: "Manuales" },
  { id: "automaticos", label: "Automáticos" },
  { id: "comex", label: "Comex" },
  { id: "ajustes", label: "Ajustes" },
  { id: "anulados", label: "Anulados" },
];

/** Preset de URL → vista tipada. Default/inválido = "todos". */
export function resolverAsientosVista(param: string | undefined): AsientosVista {
  if (param && (ASIENTOS_VISTA_IDS as readonly string[]).includes(param)) {
    return param as AsientosVista;
  }
  return "todos";
}

// Predicados de acción — espejo exacto de la `RowActions` legada
// (`asientos-table.tsx`): Contabilizar sólo BORRADOR, Anular sólo
// CONTABILIZADO. El backend re-valida (ESTADO_INVALIDO) — esto es display.
export function puedeContabilizar(estado: string): boolean {
  return estado === "BORRADOR";
}

export function puedeAnular(estado: string): boolean {
  return estado === "CONTABILIZADO";
}

/** Opción de período para el filtro principal (fechas como ISO client-safe). */
export type PeriodoOption = {
  id: number;
  codigo: string;
  nombre: string;
  estado: "ABIERTO" | "CERRADO";
  /** ISO yyyy-mm-dd… — comparación lexicográfica por prefijo de 10 chars. */
  fechaInicio: string;
  fechaFin: string;
};

function diaIso(iso: string): string {
  return iso.slice(0, 10);
}

/** Período cuyo rango [fechaInicio, fechaFin] contiene la fecha dada. */
export function periodoQueContiene(
  periodos: readonly PeriodoOption[],
  fechaIso: string,
): PeriodoOption | null {
  const dia = diaIso(fechaIso);
  return periodos.find((p) => diaIso(p.fechaInicio) <= dia && dia <= diaIso(p.fechaFin)) ?? null;
}

/**
 * Período default de la worklist: el que contiene "hoy" (el contador trabaja
 * mes a mes — OD-07 Q&A 3); fallback = el más reciente por fechaInicio.
 */
export function resolverPeriodoDefault(
  periodos: readonly PeriodoOption[],
  hoyIso: string,
): PeriodoOption | null {
  const actual = periodoQueContiene(periodos, hoyIso);
  if (actual) return actual;
  if (periodos.length === 0) return null;
  return [...periodos].sort((a, b) => b.fechaInicio.localeCompare(a.fechaInicio))[0];
}

// Chips client del grid (refinan DENTRO de la vista server-side — no son las
// vistas oficiales). Comparación por igualdad de campo (QuickFilter).
export const ORIGEN_FILTER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "MANUAL", label: "Manual" },
  { value: "TESORERIA", label: "Tesorería" },
  { value: "COMEX", label: "Comex" },
  { value: "AJUSTE", label: "Ajuste" },
  { value: "GASTO", label: "Gasto" },
];

export const ESTADO_FILTER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "BORRADOR", label: "Borrador" },
  { value: "CONTABILIZADO", label: "Contabilizado" },
  { value: "ANULADO", label: "Anulado" },
];
