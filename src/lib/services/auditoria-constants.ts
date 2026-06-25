// Constantes puras y CLIENT-SAFE de la worklist de auditoría (AUD-01). Sin
// `server-only`: las importan tanto el query server-side como los componentes
// client (filtros, columnas). Sólo etiquetas y listas derivadas de los enums
// AuditAccion/AuditOrigen — los valores crudos vienen de `prisma/enums` (puro).

import { AuditAccion, AuditOrigen } from "@/generated/prisma/enums";

/** Etiqueta legible por acción (espeja `audit-trail.tsx`, en pasado simple). */
export const ACCION_LABEL: Record<AuditAccion, string> = {
  CREATE: "Creación",
  UPDATE: "Edición",
  DELETE: "Eliminación",
  CAMBIO_ESTADO: "Cambio de estado",
  APROBACION: "Aprobación",
  CANCELACION: "Cancelación",
  EXPORTACION: "Exportación",
  VISUALIZACION_SENSIBLE: "Visualización sensible",
  MASTER_OVERRIDE: "Master override",
};

/** Etiqueta legible por origen. */
export const ORIGEN_LABEL: Record<AuditOrigen, string> = {
  MANUAL: "Manual",
  IMPORTACION: "Importación",
  AUTOMACION: "Automatización",
  API: "API",
  MASTER_OVERRIDE: "Master override",
};

/**
 * Etiqueta humana de la `tabla` auditada. Las claves SON los strings reales que
 * escribe `registrarAuditoria` (ej.: la tabla de usuarios se audita como
 * `"User"`, no `"Usuario"`). Tablas no listadas caen al propio string crudo.
 */
export const TABLA_LABEL: Record<string, string> = {
  Cliente: "Cliente",
  Proveedor: "Proveedor",
  Producto: "Producto",
  Deposito: "Depósito",
  Venta: "Venta",
  Compra: "Compra",
  Asiento: "Asiento",
  User: "Usuario",
  Perfil: "Perfil",
  UsuarioPermiso: "Permiso de usuario",
  RetencionPracticada: "Retención practicada",
  AuditLog: "Auditoría",
};

export const ACCION_VALUES: readonly AuditAccion[] = Object.values(AuditAccion);
export const ORIGEN_VALUES: readonly AuditOrigen[] = Object.values(AuditOrigen);

/** Las sub-vistas oficiales (presets de URL, server-side). `id` → `?vista=`. */
export type SubvistaId =
  | "todos"
  | "exportaciones"
  | "visualizaciones-sensibles"
  | "aprobaciones"
  | "eventos-criticos"
  | "master-overrides";

export const SUBVISTAS: readonly { id: SubvistaId; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "exportaciones", label: "Exportaciones" },
  { id: "visualizaciones-sensibles", label: "Visualizaciones sensibles" },
  { id: "aprobaciones", label: "Aprobaciones" },
  { id: "eventos-criticos", label: "Eventos críticos" },
  { id: "master-overrides", label: "Master overrides" },
];
