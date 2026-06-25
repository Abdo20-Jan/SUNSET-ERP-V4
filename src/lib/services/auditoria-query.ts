import "server-only";

import { db } from "@/lib/db";
import type { AuditAccion, AuditOrigen } from "@/generated/prisma/enums";

import { ACCION_LABEL, ORIGEN_LABEL, TABLA_LABEL } from "./auditoria-constants";
import { type AuditoriaFiltros, construirWhereAuditoria } from "./auditoria-filtros";
import { resolverRutaAuditada } from "./auditoria-rutas";

// Lectura de la worklist GLOBAL de auditoría (AUD-01). Es una query DELGADA y de
// SÓLO-LECTURA sobre AuditLog (findMany) — NO muta auditoría. Convive con el
// `getAuditLog(tabla, registroId)` por-registro de `auditoria.ts` sin tocarlo.

/** Tope de filas para la worklist en pantalla (paginación client del grid). */
export const CAP_WORKLIST = 1000;
/** Tope de filas por exportación (spec AUD-01: máx. configurable ~50k). */
export const CAP_EXPORT = 50_000;

/**
 * Fila lista para el grid: campos string PRECOMPUTADOS (para quick-search por
 * acceso directo a propiedad y sort client) + los crudos (fecha/JSON) para la
 * expansión (diff) y el EntityLink (registroHref ya resuelto server-side).
 */
export type AuditoriaRow = {
  id: number;
  fecha: string; // ISO (serializable al client)
  fechaLabel: string; // dd/MM/yyyy
  horaLabel: string; // HH:mm
  usuarioNombre: string;
  accion: AuditAccion;
  accionLabel: string;
  origen: AuditOrigen;
  origenLabel: string;
  tabla: string;
  tablaLabel: string;
  registroId: string;
  registroHref: string | null;
  documentoId: string | null;
  motivo: string | null;
  ip: string | null;
  datosAnteriores: unknown;
  datosNuevos: unknown;
};

type FilaCruda = {
  id: number;
  tabla: string;
  registroId: string;
  accion: AuditAccion;
  origen: AuditOrigen;
  fecha: Date;
  motivo: string | null;
  ip: string | null;
  documentoId: string | null;
  datosAnteriores: unknown;
  datosNuevos: unknown;
  usuario: { nombre: string };
};

function fmtFecha(d: Date): string {
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtHora(d: Date): string {
  return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

function mapearFilaAuditoria(row: FilaCruda): AuditoriaRow {
  return {
    id: row.id,
    fecha: row.fecha.toISOString(),
    fechaLabel: fmtFecha(row.fecha),
    horaLabel: fmtHora(row.fecha),
    usuarioNombre: row.usuario.nombre,
    accion: row.accion,
    accionLabel: ACCION_LABEL[row.accion] ?? row.accion,
    origen: row.origen,
    origenLabel: ORIGEN_LABEL[row.origen] ?? row.origen,
    tabla: row.tabla,
    tablaLabel: TABLA_LABEL[row.tabla] ?? row.tabla,
    registroId: row.registroId,
    registroHref: resolverRutaAuditada(row.tabla, row.registroId),
    documentoId: row.documentoId,
    motivo: row.motivo,
    ip: row.ip,
    datosAnteriores: row.datosAnteriores,
    datosNuevos: row.datosNuevos,
  };
}

/** Filas de auditoría filtradas (más reciente primero), hasta `cap`. */
export async function listarAuditoria(
  filtros: AuditoriaFiltros,
  opts?: { cap?: number },
): Promise<AuditoriaRow[]> {
  const rows = await db.auditLog.findMany({
    where: construirWhereAuditoria(filtros),
    orderBy: { fecha: "desc" },
    take: opts?.cap ?? CAP_WORKLIST,
    include: { usuario: { select: { nombre: true } } },
  });
  return rows.map(mapearFilaAuditoria);
}

/** Usuarios (id + nombre) para el filtro de la worklist. */
export async function listarUsuariosParaFiltro(): Promise<{ id: string; nombre: string }[]> {
  return db.user.findMany({ select: { id: true, nombre: true }, orderBy: { nombre: "asc" } });
}
