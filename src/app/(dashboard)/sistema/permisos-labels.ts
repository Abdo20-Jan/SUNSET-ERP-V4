import type { DimensionPermiso } from "@/generated/prisma/client";
import type { PermisoCatalogoItem } from "@/lib/actions/permisos-admin";

/*
 * Etiquetas/agrupamiento de UI para PERM-01 (client-safe; sólo tipos + consts).
 * Las 10 dimensiones canónicas del spec mapean 1:1 con el enum DimensionPermiso
 * (PR-006). El orden de declaración del enum define el orden de columnas/grupos.
 */
export const DIMENSION_ORDER: readonly DimensionPermiso[] = [
  "MODULO",
  "PAGINA",
  "ACCION",
  "CAMPO",
  "INFORMACION",
  "DOCUMENTO",
  "REPORTE",
  "EXPORTACION",
  "ESCOPO",
  "APROBACION",
];

export const DIMENSION_LABEL: Record<DimensionPermiso, string> = {
  MODULO: "Módulo",
  PAGINA: "Página",
  ACCION: "Acción",
  CAMPO: "Campo",
  INFORMACION: "Información",
  DOCUMENTO: "Documento",
  REPORTE: "Reporte",
  EXPORTACION: "Exportación",
  ESCOPO: "Escopo de datos",
  APROBACION: "Aprobación",
};

export const ROLE_LABEL: Record<"ADMIN" | "USER", string> = {
  ADMIN: "Master",
  USER: "Usuario",
};

export type DimensionGrupo = {
  dimension: DimensionPermiso;
  label: string;
  items: PermisoCatalogoItem[];
};

/** Agrupa el catálogo de permisos por dimensión, en el orden canónico. */
export function agruparPorDimension(permisos: PermisoCatalogoItem[]): DimensionGrupo[] {
  return DIMENSION_ORDER.map((dimension) => ({
    dimension,
    label: DIMENSION_LABEL[dimension],
    items: permisos.filter((p) => p.dimension === dimension),
  })).filter((g) => g.items.length > 0);
}
