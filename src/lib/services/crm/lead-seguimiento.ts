import "server-only";

/**
 * Seguimiento de leads (CRM-01 · PR-030) — READ-ONLY.
 *
 * REGLA «Sin follow-up»: un lead está sin follow-up cuando (a) su estado es
 * activo (NUEVO/CONTACTADO/CALIFICADO — descalificados y convertidos ya
 * salieron del funnel), (b) NO tiene ninguna actividad pendiente
 * (completada=false) y (c) NO registra ningún contacto completado
 * (completada=true) con `fechaCompletada` dentro de los últimos
 * `SIN_FOLLOW_UP_DIAS` días. Un lead nunca contactado y sin pendientes ES
 * sin-follow-up. El espejo puro del predicado vive en
 * `leads/_components/leads-presentacion.ts` (`esSinFollowUp`) — si esta regla
 * cambia, cambiar ambos.
 *
 * Regla adicional del plan (escalar a los 14 días al gestor) OMITIDA acá:
 * requiere noción de "gestor" que el modelo no tiene todavía — se decidirá en
 * un PR posterior.
 *
 * CERO mutaciones: sólo `findMany`/`count` sobre Lead/Actividad.
 */

import type { ActividadTipo, LeadEstado, LeadFuente, Prisma } from "@/generated/prisma/client";
import type { LeadRow } from "@/lib/actions/leads";
import { db } from "@/lib/db";

export const SIN_FOLLOW_UP_DIAS = 7;

const DAY_MS = 86_400_000;

/** Fecha de corte: contactos completados ANTES de esto no cuentan. Puro. */
export function cutoffSinFollowUp(ahora: Date, dias: number = SIN_FOLLOW_UP_DIAS): Date {
  return new Date(ahora.getTime() - dias * DAY_MS);
}

/** Proyección mínima de Actividad para derivar seguimiento en presentación. */
export type ActividadSeguimientoRow = {
  leadId: string | null;
  tipo: ActividadTipo;
  completada: boolean;
  fechaProgramada: Date | null;
  fechaCompletada: Date | null;
};

/**
 * Actividades de los leads de la PÁGINA visible (1 findMany `leadId in`,
 * select mínimo). Lista vacía → `[]` SIN query.
 */
export async function cargarActividadesSeguimiento(
  leadIds: string[],
): Promise<ActividadSeguimientoRow[]> {
  if (leadIds.length === 0) return [];
  return db.actividad.findMany({
    where: { leadId: { in: leadIds } },
    select: {
      leadId: true,
      tipo: true,
      completada: true,
      fechaProgramada: true,
      fechaCompletada: true,
    },
  });
}

// Estados del funnel donde "sin follow-up" aplica (espejo puro en
// `esSinFollowUp` de leads-presentacion.ts).
const ESTADOS_ACTIVOS: readonly LeadEstado[] = ["NUEVO", "CONTACTADO", "CALIFICADO"];

// Intersección del filtro de estado del usuario con los estados activos de la
// vista: un filtro fuera del funnel (DESCALIFICADO/CONVERTIDO) da conjunto
// vacío → la vista devuelve 0 filas sin tocar la DB.
function resolverEstadosVista(estado: LeadEstado | undefined): LeadEstado[] {
  if (!estado) return [...ESTADOS_ACTIVOS];
  if (ESTADOS_ACTIVOS.includes(estado)) return [estado];
  return [];
}

// PARIDAD: copia del `buildSearchFilter` (no exportado) de
// `@/lib/actions/leads` — misma semántica de búsqueda (nombre/empresa
// insensitive, cuit exacto-contains, email insensitive). Si `leads.ts`
// cambia su filtro, cambiar acá.
function buildSearchFilterSinFollowUp(search: string): Prisma.LeadWhereInput {
  const q = search.trim();
  if (q.length === 0) return {};
  return {
    OR: [
      { nombre: { contains: q, mode: "insensitive" } },
      { empresa: { contains: q, mode: "insensitive" } },
      { cuit: { contains: q } },
      { email: { contains: q, mode: "insensitive" } },
    ],
  };
}

type LeadConNombres = Prisma.LeadGetPayload<{
  include: {
    owner: { select: { nombre: true } };
    cliente: { select: { nombre: true } };
  };
}>;

// PARIDAD: mismo mapeo fila→LeadRow que `listarLeads` en `leads.ts`.
function toLeadRow(l: LeadConNombres): LeadRow {
  return {
    id: l.id,
    nombre: l.nombre,
    empresa: l.empresa,
    cuit: l.cuit,
    email: l.email,
    telefono: l.telefono,
    fuente: l.fuente,
    estado: l.estado,
    score: l.score,
    ownerId: l.ownerId,
    ownerNombre: l.owner.nombre,
    clienteId: l.clienteId,
    clienteNombre: l.cliente?.nombre ?? null,
    notas: l.notas,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  };
}

/**
 * Vista «Sin follow-up» con el predicado EN EL BANCO (no filtra en memoria:
 * el `total` de la paginación server es honesto). Query PROPIA que espeja el
 * where/select/orderBy de `listarLeads` (`@/lib/actions/leads` es la fuente
 * de la paridad: createdAt desc + include owner/cliente + skip/take + count
 * con el MISMO where) — la action protegida queda SIN tocar.
 */
export async function listarLeadsSinFollowUp(filtros: {
  estado?: LeadEstado;
  fuente?: LeadFuente;
  search?: string;
  page: number;
  perPage: number;
}): Promise<{ rows: LeadRow[]; total: number }> {
  const estados = resolverEstadosVista(filtros.estado);
  if (estados.length === 0) return { rows: [], total: 0 };

  const cutoff = cutoffSinFollowUp(new Date());
  const where: Prisma.LeadWhereInput = {
    estado: { in: estados },
    // (b) sin pendientes…
    actividades: { none: { completada: false } },
    // …y (c) sin contacto completado dentro de la ventana.
    NOT: { actividades: { some: { completada: true, fechaCompletada: { gte: cutoff } } } },
  };
  if (filtros.fuente) where.fuente = filtros.fuente;
  if (filtros.search) Object.assign(where, buildSearchFilterSinFollowUp(filtros.search));

  // PARIDAD: mismos clamps de paginación que `listarLeads`.
  const page = Math.max(1, Math.floor(filtros.page));
  const perPage = Math.max(1, Math.min(500, Math.floor(filtros.perPage)));
  const skip = (page - 1) * perPage;

  const [rows, total] = await Promise.all([
    db.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        owner: { select: { nombre: true } },
        cliente: { select: { nombre: true } },
      },
      take: perPage,
      skip,
    }),
    db.lead.count({ where }),
  ]);

  return { rows: rows.map(toLeadRow), total };
}
