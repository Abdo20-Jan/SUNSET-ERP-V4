// Filtros de la Central de Aprobaciones (AUTO-01 / PR-013) — PURO y client-safe
// (sin `server-only`): parsea searchParams a un `AprobacionesFiltros` validado y
// arma el `where` de Prisma. `Prisma` entra SÓLO como tipo (import type → se
// borra en compilación), así el módulo no arrastra el client al bundle. El
// builder se parte (whereDeVista + whereDeFiltros) para complejidad ciclomática ≤ 8.

import type { Prisma } from "@/generated/prisma/client";
import { EstadoSolicitud, TipoAprobacion } from "@/generated/prisma/enums";

import {
  ESTADOS_ABIERTOS,
  ESTADO_VALUES,
  type SubvistaId,
  SUBVISTA_DEFAULT,
  TIPO_VALUES,
} from "./aprobaciones-constants";

export type AprobacionesSearchParams = {
  vista?: string;
  tipo?: string;
  estado?: string;
  solicitante?: string;
  sla?: string;
};

export type AprobacionesFiltros = {
  vista: SubvistaId;
  tipo?: TipoAprobacion;
  estado?: EstadoSolicitud;
  solicitanteId?: string;
  /** true = sólo solicitudes ya en banda de SLA (≥ 50%); aplicado post-map. */
  soloRiesgoSla: boolean;
};

const ESTADOS_RESUELTOS: readonly EstadoSolicitud[] = [
  EstadoSolicitud.APROBADA,
  EstadoSolicitud.RECHAZADA,
  EstadoSolicitud.EXPIRADA,
  EstadoSolicitud.CANCELADA,
];

const VISTA_IDS: ReadonlySet<string> = new Set<SubvistaId>([
  "pendientes",
  "mis-pendientes",
  "por-vencer",
  "resueltas",
  "todos",
]);

// ── Parsers por-campo ────────────────────────────────────────────────────────

function limpiar(value?: string): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

function parseVista(value?: string): SubvistaId {
  return value && VISTA_IDS.has(value) ? (value as SubvistaId) : SUBVISTA_DEFAULT;
}

function parseTipo(value?: string): TipoAprobacion | undefined {
  const v = limpiar(value);
  return v && (TIPO_VALUES as readonly string[]).includes(v) ? (v as TipoAprobacion) : undefined;
}

function parseEstado(value?: string): EstadoSolicitud | undefined {
  const v = limpiar(value);
  return v && (ESTADO_VALUES as readonly string[]).includes(v) ? (v as EstadoSolicitud) : undefined;
}

/** searchParams crudos → filtros validados (valores desconocidos se descartan). */
export function parseFiltros(params: AprobacionesSearchParams): AprobacionesFiltros {
  const vista = parseVista(params.vista);
  return {
    vista,
    tipo: parseTipo(params.tipo),
    estado: parseEstado(params.estado),
    solicitanteId: limpiar(params.solicitante),
    soloRiesgoSla: vista === "por-vencer" || limpiar(params.sla) === "riesgo",
  };
}

// ── Builders del `where` ─────────────────────────────────────────────────────

const WHERE_DE_VISTA: Record<SubvistaId, Prisma.SolicitudWhereInput> = {
  pendientes: { estado: { in: [...ESTADOS_ABIERTOS] } },
  "mis-pendientes": { estado: { in: [...ESTADOS_ABIERTOS] } },
  "por-vencer": { estado: { in: [...ESTADOS_ABIERTOS] } },
  resueltas: { estado: { in: [...ESTADOS_RESUELTOS] } },
  todos: {},
};

export function whereDeVista(vista: SubvistaId): Prisma.SolicitudWhereInput {
  return WHERE_DE_VISTA[vista];
}

export function whereDeFiltros(f: AprobacionesFiltros): Prisma.SolicitudWhereInput {
  const where: Prisma.SolicitudWhereInput = {};
  if (f.tipo) where.tipo = f.tipo;
  if (f.estado) where.estado = f.estado;
  if (f.solicitanteId) where.solicitanteId = f.solicitanteId;
  return where;
}

/**
 * `where` final: intersección (AND) del preset de la sub-vista con los filtros
 * explícitos. `tiposAprobables` se inyecta sólo para la vista "mis-pendientes"
 * (los tipos que el usuario actual puede aprobar — se resuelve en la query, que
 * conoce la sesión).
 */
export function construirWhereAprobaciones(
  f: AprobacionesFiltros,
  tiposAprobables?: readonly TipoAprobacion[],
): Prisma.SolicitudWhereInput {
  const extra: Prisma.SolicitudWhereInput =
    f.vista === "mis-pendientes" ? { tipo: { in: [...(tiposAprobables ?? [])] } } : {};
  return { AND: [whereDeVista(f.vista), whereDeFiltros(f), extra] };
}
