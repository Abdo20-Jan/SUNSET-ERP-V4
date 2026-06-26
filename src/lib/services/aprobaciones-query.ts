import "server-only";

// Lectura de la Central de Aprobaciones (AUTO-01 / PR-013). Queries DELGADAS y de
// SÓLO-LECTURA sobre `Solicitud`/`Aprobacion` (el motor PR-012 no expone reads).
// NO mutan ni tocan el motor. **INERTE**: con APPROVALS_ENABLED=off cortocircuitan
// a vacío/0 (no hay solicitudes → cero cambio de comportamiento). El SLA visual se
// deriva con `computeHito` (PR-012, puro); el href del documento reutiliza
// `resolverRutaAuditada` (misma clave polimórfica `tabla+registroId` del AuditLog).

import type { Moneda } from "@/generated/prisma/client";
import { EstadoSolicitud, TipoAprobacion, TipoDecisionAprobacion } from "@/generated/prisma/enums";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isApprovalsEnabled } from "@/lib/features";
import { hasPermission } from "@/lib/permisos";
import type { PermisoKey } from "@/lib/permisos-catalog";
import { Role } from "@/generated/prisma/client";

import { type AprobacionesFiltros, construirWhereAprobaciones } from "./aprobaciones-filtros";
import { estadoLabel, SLA_BANDA_LABEL, tipoLabel, TIPO_VALUES } from "./aprobaciones-constants";
import { type BandaSla, computeHito } from "./aprobaciones-helpers";
import { getConfigAprobacion } from "./aprobaciones-matriz";
import { resolverRutaAuditada } from "./auditoria-rutas";

/** Tope de filas para la worklist en pantalla (paginación client del grid). */
export const CAP_APROBACIONES = 1000;

/** Decisión legible para el historial de liberaciones. */
const DECISION_LABEL: Record<TipoDecisionAprobacion, string> = {
  [TipoDecisionAprobacion.APROBADA]: "Aprobó",
  [TipoDecisionAprobacion.RECHAZADA]: "Rechazó",
  [TipoDecisionAprobacion.INFO_SOLICITADA]: "Solicitó información",
};

/** Fila lista para el grid: campos PRECOMPUTADOS (quick-search + sort client). */
export type AprobacionRow = {
  id: string;
  tipo: TipoAprobacion;
  tipoLabel: string;
  estado: EstadoSolicitud;
  estadoLabel: string;
  tabla: string;
  registroId: string;
  documentoHref: string | null;
  solicitanteNombre: string;
  valor: string | null;
  moneda: Moneda | null;
  slaBanda: BandaSla;
  slaLabel: string;
  venceEn: string; // ISO (sort)
  venceEnLabel: string;
  aprobadorNombre: string;
  permisoAprobacion: PermisoKey;
  requiereDupla: boolean;
  esSolicitante: boolean;
};

/** Un evento del historial de liberaciones (una `Aprobacion`). */
export type AprobacionHistorialItem = {
  id: string;
  decisionLabel: string;
  aprobadorNombre: string;
  comentario: string | null;
  fechaLabel: string;
  esMasterOverride: boolean;
};

/** Detalle para la janela de decisão (solicitud + historial + otras del documento). */
export type SolicitudDetalle = AprobacionRow & {
  motivo: string;
  comentarioResolucion: string | null;
  anexos: unknown;
  historial: AprobacionHistorialItem[];
  otrasDelDocumento: AprobacionRow[];
};

type SesionActual = { userId: string | null; esAdmin: boolean };

async function sesionActual(): Promise<SesionActual> {
  const session = await auth();
  return {
    userId: session?.user?.id ?? null,
    esAdmin: session?.user?.role === Role.ADMIN,
  };
}

// El include estándar para mapear una fila (solicitante + última aprobación).
const INCLUDE_FILA = {
  solicitante: { select: { nombre: true } },
  aprobaciones: {
    orderBy: { createdAt: "desc" },
    take: 1,
    include: { aprobador: { select: { nombre: true } } },
  },
} as const;

type FilaCruda = {
  id: string;
  tipo: TipoAprobacion;
  estado: EstadoSolicitud;
  tabla: string;
  registroId: string;
  solicitanteId: string;
  valor: { toString(): string } | null;
  moneda: Moneda | null;
  slaHoras: number;
  venceEn: Date;
  requiereDupla: boolean;
  nivelEscalonamiento: number;
  solicitante: { nombre: string };
  aprobaciones: { aprobador: { nombre: string } }[];
};

function fmtFechaHora(d: Date): string {
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Banda de SLA para la fila: sólo las abiertas "corren"; EXPIRADA = vencida. */
function bandaParaFila(row: FilaCruda, ahora: Date): BandaSla {
  if (row.estado === EstadoSolicitud.EXPIRADA) return 100;
  if (row.estado !== EstadoSolicitud.PENDIENTE && row.estado !== EstadoSolicitud.SOLICITANDO_INFO) {
    return 0;
  }
  return computeHito({
    venceEn: row.venceEn,
    slaHoras: row.slaHoras,
    nivelEscalonamiento: row.nivelEscalonamiento,
    ahora,
  }).banda;
}

function mapearFila(row: FilaCruda, ctx: { userId: string | null; ahora: Date }): AprobacionRow {
  const banda = bandaParaFila(row, ctx.ahora);
  const ultimoAprobador = row.aprobaciones[0]?.aprobador.nombre ?? null;
  return {
    id: row.id,
    tipo: row.tipo,
    tipoLabel: tipoLabel(row.tipo),
    estado: row.estado,
    estadoLabel: estadoLabel(row.estado),
    tabla: row.tabla,
    registroId: row.registroId,
    documentoHref: resolverRutaAuditada(row.tabla, row.registroId),
    solicitanteNombre: row.solicitante.nombre,
    valor: row.valor?.toString() ?? null,
    moneda: row.moneda,
    slaBanda: banda,
    slaLabel: SLA_BANDA_LABEL[banda],
    venceEn: row.venceEn.toISOString(),
    venceEnLabel: fmtFechaHora(row.venceEn),
    aprobadorNombre: ultimoAprobador ?? "Sin asignar",
    permisoAprobacion: getConfigAprobacion(row.tipo).permisoAprobacion,
    requiereDupla: row.requiereDupla,
    esSolicitante: ctx.userId != null && row.solicitanteId === ctx.userId,
  };
}

/** Tipos que el usuario ACTUAL puede aprobar (matriz × hasPermission). */
export async function tiposAprobablesPorUsuario(): Promise<TipoAprobacion[]> {
  if (!isApprovalsEnabled()) return [];
  const tipos: TipoAprobacion[] = [];
  for (const tipo of TIPO_VALUES) {
    if (await hasPermission(getConfigAprobacion(tipo).permisoAprobacion)) tipos.push(tipo);
  }
  return tipos;
}

/** Filas de la worklist filtradas; INERTE si la flag está off. */
export async function listarAprobaciones(filtros: AprobacionesFiltros): Promise<AprobacionRow[]> {
  if (!isApprovalsEnabled()) return [];
  const { userId } = await sesionActual();
  const tiposAprobables =
    filtros.vista === "mis-pendientes" ? await tiposAprobablesPorUsuario() : undefined;

  const rows = (await db.solicitud.findMany({
    where: construirWhereAprobaciones(filtros, tiposAprobables),
    orderBy: { venceEn: "asc" },
    take: CAP_APROBACIONES,
    include: INCLUDE_FILA,
  })) as unknown as FilaCruda[];

  const ahora = new Date();
  const mapeadas = rows.map((r) => mapearFila(r, { userId, ahora }));
  // El preset "por-vencer" / sla=riesgo filtra a las que ya entraron en banda.
  return filtros.soloRiesgoSla ? mapeadas.filter((r) => r.slaBanda >= 50) : mapeadas;
}

/** Solicitudes vinculadas a un documento (aba contextual); INERTE si off. */
export async function listarAprobacionesDeDocumento(
  tabla: string,
  registroId: string,
): Promise<AprobacionRow[]> {
  if (!isApprovalsEnabled()) return [];
  const { userId } = await sesionActual();
  const rows = (await db.solicitud.findMany({
    where: { tabla, registroId },
    orderBy: { createdAt: "desc" },
    take: CAP_APROBACIONES,
    include: INCLUDE_FILA,
  })) as unknown as FilaCruda[];
  const ahora = new Date();
  return rows.map((r) => mapearFila(r, { userId, ahora }));
}

/** Detalle de una solicitud para la janela de decisão; null si off / inexistente. */
export async function getSolicitudParaDecision(id: string): Promise<SolicitudDetalle | null> {
  if (!isApprovalsEnabled()) return null;
  const { userId } = await sesionActual();
  const solicitud = await db.solicitud.findUnique({
    where: { id },
    include: {
      ...INCLUDE_FILA,
      aprobaciones: {
        orderBy: { createdAt: "desc" },
        include: { aprobador: { select: { nombre: true } } },
      },
    },
  });
  if (!solicitud) return null;

  const ahora = new Date();
  const fila = mapearFila(solicitud as unknown as FilaCruda, { userId, ahora });
  const historial: AprobacionHistorialItem[] = solicitud.aprobaciones.map((a) => ({
    id: a.id,
    decisionLabel: DECISION_LABEL[a.decision] ?? a.decision,
    aprobadorNombre: a.aprobador.nombre,
    comentario: a.comentario,
    fechaLabel: fmtFechaHora(a.createdAt),
    esMasterOverride: a.esMasterOverride,
  }));

  const otras = await listarAprobacionesDeDocumento(solicitud.tabla, solicitud.registroId);
  return {
    ...fila,
    motivo: solicitud.motivo,
    comentarioResolucion: solicitud.comentarioResolucion,
    anexos: solicitud.anexos,
    historial,
    otrasDelDocumento: otras.filter((o) => o.id !== solicitud.id),
  };
}

// ── Dashboard: cola del usuario actual (lo que espera SU decisión) ────────────

async function pendientesDelUsuario(take?: number): Promise<AprobacionRow[]> {
  if (!isApprovalsEnabled()) return [];
  const tipos = await tiposAprobablesPorUsuario();
  if (tipos.length === 0) return [];
  const { userId } = await sesionActual();
  const rows = (await db.solicitud.findMany({
    where: {
      estado: { in: [EstadoSolicitud.PENDIENTE, EstadoSolicitud.SOLICITANDO_INFO] },
      tipo: { in: tipos },
    },
    orderBy: { venceEn: "asc" },
    take: take ?? CAP_APROBACIONES,
    include: INCLUDE_FILA,
  })) as unknown as FilaCruda[];
  const ahora = new Date();
  return rows.map((r) => mapearFila(r, { userId, ahora }));
}

/** Resumen para el bloque del dashboard (contador + top N por SLA). */
export async function getPendientesDashboard(
  topN = 3,
): Promise<{ count: number; top: AprobacionRow[] }> {
  if (!isApprovalsEnabled()) return { count: 0, top: [] };
  const todas = await pendientesDelUsuario();
  return { count: todas.length, top: todas.slice(0, topN) };
}

/** Solicitantes (id + nombre) presentes en solicitudes, para el filtro. */
export async function listarSolicitantesParaFiltro(): Promise<{ id: string; nombre: string }[]> {
  if (!isApprovalsEnabled()) return [];
  const ids = await db.solicitud.findMany({
    distinct: ["solicitanteId"],
    select: { solicitante: { select: { id: true, nombre: true } } },
    orderBy: { solicitante: { nombre: "asc" } },
  });
  return ids.map((r) => r.solicitante);
}
