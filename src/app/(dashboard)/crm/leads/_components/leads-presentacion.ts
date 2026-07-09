/**
 * Helpers PUROS de presentación de la worklist de leads (CRM-01 · PR-030).
 * Client-safe y sin JSX — importable tanto desde la page RSC como desde los
 * componentes client y la export action (idioma de
 * `pedidos-compra-presentacion.ts`, PR-029).
 *
 * READ-ONLY: proyecta (aplana) lo que `listarLeads` /
 * `listarLeadsSinFollowUp` YA devuelven e inyecta el seguimiento DERIVADO de
 * las actividades cargadas aparte (el Lead NO tiene campo
 * proximaAccion/últimoContacto en el schema — se deriva de `Actividad`).
 * CERO queries acá. Las sub-vistas oficiales son presets de URL server-side
 * (lección PR-010).
 */

import type { ActividadTipo, LeadEstado, LeadFuente } from "@/generated/prisma/client";
import type { LeadRow } from "@/lib/actions/leads";
import { LEAD_ESTADOS, LEAD_FUENTES } from "@/lib/crm-enums";

/**
 * Shape mínimo de actividad para derivar seguimiento. Compatible por
 * estructura con `ActividadSeguimientoRow` de
 * `@/lib/services/crm/lead-seguimiento` (que este módulo NO importa para
 * seguir siendo client-safe).
 */
export type ActividadSeguimientoLike = {
  leadId: string | null;
  tipo: ActividadTipo;
  completada: boolean;
  fechaProgramada: Date | null;
  fechaCompletada: Date | null;
};

/** Seguimiento derivado de las actividades de UN lead. */
export type LeadSeguimiento = {
  /** Existe al menos una actividad pendiente (completada=false). */
  tienePendiente: boolean;
  /** Pendiente con MENOR fechaProgramada (null = sólo pendientes sin fecha). */
  proximaAccionFecha: Date | null;
  proximaAccionTipo: ActividadTipo | null;
  /** Completada con MAYOR fechaCompletada. */
  ultimoContactoFecha: Date | null;
  ultimoContactoTipo: ActividadTipo | null;
};

/** Fila del grid: LeadRow aplanado + seguimiento derivado. */
export type LeadWorklistRow = {
  id: string;
  nombre: string;
  empresa: string | null;
  cuit: string | null;
  email: string | null;
  telefono: string | null;
  fuente: LeadFuente;
  estado: LeadEstado;
  score: number;
  ownerId: string;
  ownerNombre: string;
  clienteId: string | null;
  clienteNombre: string | null;
  createdAt: string;
  proximaAccionFecha: string | null;
  proximaAccionTipo: ActividadTipo | null;
  tienePendiente: boolean;
  ultimoContactoFecha: string | null;
  ultimoContactoTipo: ActividadTipo | null;
  sinFollowUp: boolean;
};

function seguimientoVacio(): LeadSeguimiento {
  return {
    tienePendiente: false,
    proximaAccionFecha: null,
    proximaAccionTipo: null,
    ultimoContactoFecha: null,
    ultimoContactoTipo: null,
  };
}

// Próxima acción = pendiente con MENOR fechaProgramada. Un pendiente SIN
// fecha marca `tienePendiente` (la celda muestra «Pendiente sin fecha»
// cuando ningún pendiente tiene fecha) pero no compite por la fecha mínima.
function aplicarPendiente(seg: LeadSeguimiento, a: ActividadSeguimientoLike): void {
  seg.tienePendiente = true;
  if (!a.fechaProgramada) return;
  if (seg.proximaAccionFecha === null || a.fechaProgramada < seg.proximaAccionFecha) {
    seg.proximaAccionFecha = a.fechaProgramada;
    seg.proximaAccionTipo = a.tipo;
  }
}

// Último contacto = completada con MAYOR fechaCompletada (una completada sin
// fechaCompletada no es rankeable y se ignora).
function aplicarCompletada(seg: LeadSeguimiento, a: ActividadSeguimientoLike): void {
  if (!a.fechaCompletada) return;
  if (seg.ultimoContactoFecha === null || a.fechaCompletada > seg.ultimoContactoFecha) {
    seg.ultimoContactoFecha = a.fechaCompletada;
    seg.ultimoContactoTipo = a.tipo;
  }
}

/** Deriva el seguimiento por lead a partir de las actividades cargadas. */
export function derivarSeguimiento(
  actividades: readonly ActividadSeguimientoLike[],
): Map<string, LeadSeguimiento> {
  const map = new Map<string, LeadSeguimiento>();
  for (const a of actividades) {
    if (!a.leadId) continue;
    const seg = map.get(a.leadId) ?? seguimientoVacio();
    if (a.completada) aplicarCompletada(seg, a);
    else aplicarPendiente(seg, a);
    map.set(a.leadId, seg);
  }
  return map;
}

// Estados donde "sin follow-up" tiene sentido — espejo del predicado SQL de
// `listarLeadsSinFollowUp` (`estado in (NUEVO, CONTACTADO, CALIFICADO)`).
const ESTADOS_SIN_FOLLOW_UP: readonly LeadEstado[] = ["NUEVO", "CONTACTADO", "CALIFICADO"];

/**
 * Espejo PURO del predicado SQL de `listarLeadsSinFollowUp`
 * (`@/lib/services/crm/lead-seguimiento`): estado activo + sin pendientes
 * (`actividades none completada=false`) + sin contacto completado dentro de
 * la ventana (`NOT some completada=true fechaCompletada >= cutoff`). El
 * default `dias = 7` espeja `SIN_FOLLOW_UP_DIAS`; si cambia allá, cambia acá.
 * Contacto EXACTAMENTE en el cutoff cuenta como reciente (gte) → NO es
 * sin-follow-up.
 */
export function esSinFollowUp(
  seg: LeadSeguimiento | undefined,
  estado: LeadEstado,
  ahora: Date,
  dias = 7,
): boolean {
  if (!ESTADOS_SIN_FOLLOW_UP.includes(estado)) return false;
  if (seg?.tienePendiente) return false;
  const cutoff = new Date(ahora.getTime() - dias * 86_400_000);
  if (seg?.ultimoContactoFecha && seg.ultimoContactoFecha >= cutoff) return false;
  return true;
}

function isoOrNull(d: Date | null): string | null {
  if (!d) return null;
  return d.toISOString();
}

// Proyección serializable del seguimiento (helper nombrado — CCN baja).
function proyectarSeguimiento(seg: LeadSeguimiento | undefined) {
  const s = seg ?? seguimientoVacio();
  return {
    proximaAccionFecha: isoOrNull(s.proximaAccionFecha),
    proximaAccionTipo: s.proximaAccionTipo,
    tienePendiente: s.tienePendiente,
    ultimoContactoFecha: isoOrNull(s.ultimoContactoFecha),
    ultimoContactoTipo: s.ultimoContactoTipo,
  };
}

function flattenLead(l: LeadRow, seg: LeadSeguimiento | undefined, ahora: Date): LeadWorklistRow {
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
    ownerNombre: l.ownerNombre,
    clienteId: l.clienteId,
    clienteNombre: l.clienteNombre,
    createdAt: l.createdAt.toISOString(),
    ...proyectarSeguimiento(seg),
    sinFollowUp: esSinFollowUp(seg, l.estado, ahora),
  };
}

/**
 * Aplana los leads (1:1, mismo orden del servicio — createdAt desc) e
 * inyecta el seguimiento derivado (lead sin actividades → nulls, sin
 * pendiente). No agrega ni recalcula nada más.
 */
export function flattenLeads(
  rows: LeadRow[],
  seguimiento: ReadonlyMap<string, LeadSeguimiento>,
  ahora: Date,
): LeadWorklistRow[] {
  return rows.map((l) => flattenLead(l, seguimiento.get(l.id), ahora));
}

// Sub-vistas oficiales = presets de URL server-side (espejo COMP-01): "mios"
// filtra por owner de la sesión (presentación, NO seguridad) y
// "sin-follow-up" delega en la query propia del servicio.
export type LeadsVista = "todos" | "mios" | "sin-follow-up";

export const VISTA_LABELS: Record<LeadsVista, string> = {
  todos: "Todos",
  mios: "Míos",
  "sin-follow-up": "Sin follow-up",
};

export function resolverVista(param: string | undefined): LeadsVista {
  if (param === "mios" || param === "sin-follow-up") return param;
  return "todos";
}

/**
 * Href de la worklist preservando filtros: omite defaults (`vista=todos`,
 * `perPage=50`) y SIEMPRE resetea `page` (cambiar de vista/filtro invalida la
 * página server actual).
 */
function setParamSi(qp: URLSearchParams, key: string, value: string | undefined): void {
  if (value) qp.set(key, value);
}

// Defaults se OMITEN de la URL (vista=todos, perPage=50).
function vistaParam(vista: LeadsVista | undefined): string | undefined {
  if (!vista || vista === "todos") return undefined;
  return vista;
}

function perPageParam(perPage: string | undefined): string | undefined {
  if (!perPage || perPage === "50") return undefined;
  return perPage;
}

export function buildLeadsHref(opts: {
  vista?: LeadsVista;
  q?: string;
  estado?: string;
  fuente?: string;
  perPage?: string;
}): string {
  const qp = new URLSearchParams();
  setParamSi(qp, "vista", vistaParam(opts.vista));
  setParamSi(qp, "q", opts.q);
  setParamSi(qp, "estado", opts.estado);
  setParamSi(qp, "fuente", opts.fuente);
  setParamSi(qp, "perPage", perPageParam(opts.perPage));
  const qs = qp.toString();
  if (qs.length === 0) return "/crm/leads";
  return `/crm/leads?${qs}`;
}

// Parsers compartidos page ↔ export action (paridad de filtros). Validan
// contra los literales de `crm-enums` — sin import de VALOR del client de
// Prisma en un módulo client-safe.
export function parseLeadEstado(v: string | undefined): LeadEstado | undefined {
  if (v && (LEAD_ESTADOS as readonly string[]).includes(v)) return v as LeadEstado;
  return undefined;
}

export function parseLeadFuente(v: string | undefined): LeadFuente | undefined {
  if (v && (LEAD_FUENTES as readonly string[]).includes(v)) return v as LeadFuente;
  return undefined;
}
