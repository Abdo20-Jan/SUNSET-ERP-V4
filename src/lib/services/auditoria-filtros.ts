// Filtros de la worklist de auditoría (AUD-01) — PURO y client-safe (sin
// `server-only`): parsea searchParams a un `AuditoriaFiltros` validado y arma
// el `where` de Prisma. Sin I/O → trivialmente testeable.
//
// `Prisma` entra SÓLO como tipo (import type → se borra en compilación): el
// objeto `where` resultante es un literal plano sin runtime de Prisma, así el
// módulo no arrastra el client al bundle. Los enums vienen de `prisma/enums`
// (puro). El builder se parte en `whereDeVista` (presets) + `whereDeFiltros`
// (campos explícitos) para mantener la complejidad ciclomática ≤ 8.

import type { Prisma } from "@/generated/prisma/client";
import { AuditAccion, AuditOrigen } from "@/generated/prisma/enums";

import { ACCION_VALUES, ORIGEN_VALUES, type SubvistaId } from "./auditoria-constants";

export type AuditoriaSearchParams = {
  vista?: string;
  desde?: string;
  hasta?: string;
  usuario?: string;
  tabla?: string;
  accion?: string;
  origen?: string;
  motivo?: string;
};

export type AuditoriaFiltros = {
  vista?: SubvistaId;
  desde?: Date;
  hasta?: Date;
  usuarioId?: string;
  tabla?: string;
  accion?: AuditAccion;
  origen?: AuditOrigen;
  motivo?: string;
};

// ── Parsers por-campo (cada uno valida y normaliza) ──────────────────────────

function limpiar(value?: string): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

const SUBVISTA_IDS: ReadonlySet<string> = new Set<SubvistaId>([
  "todos",
  "exportaciones",
  "visualizaciones-sensibles",
  "aprobaciones",
  "eventos-criticos",
  "master-overrides",
]);

function parseVista(value?: string): SubvistaId | undefined {
  return value && SUBVISTA_IDS.has(value) ? (value as SubvistaId) : undefined;
}

function parseFechaInicio(value?: string): Date | undefined {
  const v = limpiar(value);
  if (!v) return undefined;
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseFechaFin(value?: string): Date | undefined {
  const v = limpiar(value);
  if (!v) return undefined;
  const d = new Date(`${v}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseAccion(value?: string): AuditAccion | undefined {
  const v = limpiar(value);
  return v && (ACCION_VALUES as readonly string[]).includes(v) ? (v as AuditAccion) : undefined;
}

function parseOrigen(value?: string): AuditOrigen | undefined {
  const v = limpiar(value);
  return v && (ORIGEN_VALUES as readonly string[]).includes(v) ? (v as AuditOrigen) : undefined;
}

/** searchParams crudos → filtros validados (valores desconocidos se descartan). */
export function parseFiltros(params: AuditoriaSearchParams): AuditoriaFiltros {
  return {
    vista: parseVista(params.vista),
    desde: parseFechaInicio(params.desde),
    hasta: parseFechaFin(params.hasta),
    usuarioId: limpiar(params.usuario),
    tabla: limpiar(params.tabla),
    accion: parseAccion(params.accion),
    origen: parseOrigen(params.origen),
    motivo: limpiar(params.motivo),
  };
}

// ── Builders del `where` ─────────────────────────────────────────────────────

/** Constraint de fecha (gte/lte) o undefined si no hay rango. */
function rangoFecha(desde?: Date, hasta?: Date): Prisma.DateTimeFilter | undefined {
  if (!desde && !hasta) return undefined;
  return { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) };
}

/** `where` de la sub-vista oficial (preset por acción/origen). Mapa → complejidad 1. */
const WHERE_DE_VISTA: Record<SubvistaId, Prisma.AuditLogWhereInput> = {
  todos: {},
  exportaciones: { accion: AuditAccion.EXPORTACION },
  "visualizaciones-sensibles": { accion: AuditAccion.VISUALIZACION_SENSIBLE },
  aprobaciones: { accion: AuditAccion.APROBACION },
  "eventos-criticos": {
    accion: { in: [AuditAccion.MASTER_OVERRIDE, AuditAccion.CANCELACION, AuditAccion.DELETE] },
  },
  "master-overrides": {
    OR: [{ accion: AuditAccion.MASTER_OVERRIDE }, { origen: AuditOrigen.MASTER_OVERRIDE }],
  },
};

export function whereDeVista(vista?: SubvistaId): Prisma.AuditLogWhereInput {
  return vista ? WHERE_DE_VISTA[vista] : {};
}

/** `where` de los filtros explícitos de la barra. */
export function whereDeFiltros(f: AuditoriaFiltros): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  const fecha = rangoFecha(f.desde, f.hasta);
  if (fecha) where.fecha = fecha;
  if (f.usuarioId) where.usuarioId = f.usuarioId;
  if (f.tabla) where.tabla = f.tabla;
  if (f.accion) where.accion = f.accion;
  if (f.origen) where.origen = f.origen;
  if (f.motivo) where.motivo = { contains: f.motivo, mode: "insensitive" };
  return where;
}

/**
 * `where` final: intersección (AND) del preset de la sub-vista con los filtros
 * explícitos. El AND maneja solo el solape (ej.: preset acción∈{…} + filtro
 * acción=X ⇒ acción=X si X∈{…}), sin lógica de precedencia.
 */
export function construirWhereAuditoria(f: AuditoriaFiltros): Prisma.AuditLogWhereInput {
  return { AND: [whereDeVista(f.vista), whereDeFiltros(f)] };
}
