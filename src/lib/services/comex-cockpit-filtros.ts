/**
 * Helpers PUROS de filtros del Cockpit Operacional Comex (PR-022b / CX-01).
 *
 * Sin I/O, sin `server-only`: los importan tanto el read server-side
 * (`comex-cockpit.ts` → narrowing) como la barra client (`cockpit-filtros.tsx`
 * → tabs/labels/opciones). Toda derivación recibe `now` INYECTADO (nunca
 * `Date.now()` interno) para ser determinista/unit-testable y evitar mismatch de
 * hidratación.
 *
 * Capa ADITIVA y de SÓLO LECTURA sobre PR-022a: parsea `searchParams` a un
 * `CockpitFiltros`, define los presets (saved-views ESTÁTICAS — combos de filtro
 * en URL, NO el modelo `SavedView` persistido) y aplica el narrowing in-memory
 * sobre el `enriched[]` ya cargado. NUNCA consulta, NUNCA recalcula, NUNCA toca
 * el motor de rateio (G-09). Con filtros vacíos el narrowing es un no-op → el
 * cockpit es idéntico a PR-022a. Reusa las derivaciones existentes
 * (`resolverVistaFiltro` de la worklist; `clasificarSeveridad` /
 * `bandDiasSinActualizacion` del cockpit) — acá sólo vive el parsing/narrowing.
 */

import type { EmbarqueEstado } from "@/generated/prisma/client";
import {
  bandDiasSinActualizacion,
  clasificarSeveridad,
} from "@/lib/services/comex-cockpit-derivaciones";
import { type EtaTono, resolverVistaFiltro } from "@/lib/services/comex-worklist-derivaciones";

// ── Modelo de filtros ────────────────────────────────────────────────────────

/** Opción del select de Proveedor (derivada del universo cargado; sin valores). */
export type ProveedorOpcion = { id: string; nombre: string };

/** Narrowing derivado (no estructural): reusa predicados puros existentes. */
export type CockpitFoco = "criticos" | "sin-actualizar" | "pagos";

export type CockpitFiltros = {
  proveedorId?: string;
  /** Membership de estado (filtro Status y/o preset En tránsito). */
  estado?: EmbarqueEstado[];
  etaDesde?: Date;
  etaHasta?: Date;
  foco?: CockpitFoco;
};

export type CockpitVistaId =
  | "todos"
  | "criticos"
  | "proximos"
  | "transito"
  | "sin-actualizar"
  | "pagos";

export type CockpitVistaDef = {
  id: CockpitVistaId;
  label: string;
  /** Si está presente, la vista sólo se ofrece/aplica con ese permiso financiero. */
  requierePermiso?: "VER_COSTO_LANDED";
};

/** Presets oficiales (CX-01 §6). `pagos` gateado por `VER_COSTO_LANDED`. */
export const COCKPIT_VISTAS: readonly CockpitVistaDef[] = [
  { id: "todos", label: "Todos" },
  { id: "criticos", label: "Críticos" },
  { id: "proximos", label: "Próximos arribos" },
  { id: "transito", label: "En tránsito" },
  { id: "sin-actualizar", label: "Sin actualizar" },
  { id: "pagos", label: "Pagos próximos", requierePermiso: "VER_COSTO_LANDED" },
];

const VISTA_IDS: ReadonlySet<string> = new Set(COCKPIT_VISTAS.map((v) => v.id));

/** Estados válidos del filtro Status = universo del cockpit (procesos NO cerrados). */
const ESTADOS_NO_CERRADO: ReadonlySet<EmbarqueEstado> = new Set<EmbarqueEstado>([
  "BORRADOR",
  "EN_TRANSITO",
  "EN_PUERTO",
  "EN_ZONA_PRIMARIA",
  "EN_ADUANA",
  "DESPACHADO",
  "EN_DEPOSITO",
]);

/** Opciones del select de Status (orden de avance del proceso). */
export const STATUS_FILTRO_OPCIONES: readonly EmbarqueEstado[] = [
  "BORRADOR",
  "EN_TRANSITO",
  "EN_PUERTO",
  "EN_ZONA_PRIMARIA",
  "EN_ADUANA",
  "DESPACHADO",
  "EN_DEPOSITO",
];

// ── Parse / normalización ────────────────────────────────────────────────────

export function parseCockpitVista(v: string | undefined): CockpitVistaId {
  return v != null && VISTA_IDS.has(v) ? (v as CockpitVistaId) : "todos";
}

/** Presets → filtros base. Reusa `resolverVistaFiltro` para proximos/transito. */
export function presetToFiltros(vista: CockpitVistaId, now: Date): CockpitFiltros {
  switch (vista) {
    case "criticos":
      return { foco: "criticos" };
    case "sin-actualizar":
      return { foco: "sin-actualizar" };
    case "pagos":
      return { foco: "pagos" };
    case "proximos":
      return { etaHasta: resolverVistaFiltro("proximos", now).etaHasta };
    case "transito":
      return { estado: resolverVistaFiltro("transito", now).estado };
    default:
      return {};
  }
}

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function parseFecha(s: string | undefined, finDelDia: boolean): Date | undefined {
  if (!s || !FECHA_ISO.test(s)) return undefined;
  const d = new Date(`${s}T${finDelDia ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseEstado(s: string | undefined): EmbarqueEstado[] | undefined {
  if (!s) return undefined;
  return ESTADOS_NO_CERRADO.has(s as EmbarqueEstado) ? [s as EmbarqueEstado] : undefined;
}

export type CockpitSearchParams = {
  vista?: string;
  proveedor?: string;
  eta_desde?: string;
  eta_hasta?: string;
  estado?: string;
};

export type CockpitFiltrosParsed = { vista: CockpitVistaId; filtros: CockpitFiltros };

/**
 * `searchParams` → `{ vista, filtros }`. Params inválidos se DESCARTAN (nunca
 * lanzan); params explícitos sobrescriben el campo correspondiente del preset.
 * Vacío (`vista=todos` + sin params) ⇒ `filtros = {}` ⇒ narrowing no-op (PR-022a).
 */
export function parseCockpitFiltros(params: CockpitSearchParams, now: Date): CockpitFiltrosParsed {
  const vista = parseCockpitVista(params.vista);
  const filtros: CockpitFiltros = { ...presetToFiltros(vista, now) };

  const proveedorId = params.proveedor?.trim();
  if (proveedorId) filtros.proveedorId = proveedorId;

  const estado = parseEstado(params.estado);
  if (estado) filtros.estado = estado; // override explícito del preset

  const etaDesde = parseFecha(params.eta_desde, false);
  if (etaDesde) filtros.etaDesde = etaDesde;

  const etaHasta = parseFecha(params.eta_hasta, true);
  // Descarta `hasta` inconsistente (desde > hasta); preserva el `etaHasta` del preset si no se dio.
  if (etaHasta && (!etaDesde || etaHasta.getTime() >= etaDesde.getTime())) {
    filtros.etaHasta = etaHasta;
  }

  return { vista, filtros };
}

/** Construye un query string a partir de params crudos (drop de vacíos). Para [Ver todos]. */
export function cockpitFiltrosToQuery(params: Record<string, string | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") sp.set(key, value);
  }
  return sp.toString();
}

// ── Narrowing in-memory (puro) sobre el enriched[] ya cargado ────────────────

/** Forma mínima que el narrowing necesita de cada embarque enriquecido. */
export type EnrichedParaFiltro = {
  ref: { id: string; estado: EmbarqueEstado };
  proveedorId: string;
  fechaLlegada: Date | null;
  updatedAt: Date;
  bloqueo: string | null;
  etaTono: EtaTono;
};

export type AplicarCtx = { now: Date; pagosEmbarqueIds: ReadonlySet<string> };

function pasaProveedor(e: EnrichedParaFiltro, f: CockpitFiltros): boolean {
  return !f.proveedorId || e.proveedorId === f.proveedorId;
}

function pasaEstado(e: EnrichedParaFiltro, f: CockpitFiltros): boolean {
  return !f.estado || f.estado.includes(e.ref.estado);
}

function pasaEta(e: EnrichedParaFiltro, f: CockpitFiltros): boolean {
  if (!f.etaDesde && !f.etaHasta) return true;
  if (e.fechaLlegada == null) return false; // un filtro de ETA excluye ETA nula
  const t = e.fechaLlegada.getTime();
  if (f.etaDesde && t < f.etaDesde.getTime()) return false;
  if (f.etaHasta && t > f.etaHasta.getTime()) return false;
  return true;
}

function pasaFoco(e: EnrichedParaFiltro, f: CockpitFiltros, ctx: AplicarCtx): boolean {
  switch (f.foco) {
    case "criticos":
      return clasificarSeveridad({ bloqueo: e.bloqueo, etaTono: e.etaTono }) === "critico";
    case "sin-actualizar":
      return bandDiasSinActualizacion(e.updatedAt, ctx.now) !== "fresca";
    case "pagos":
      return ctx.pagosEmbarqueIds.has(e.ref.id);
    default:
      return true;
  }
}

/**
 * Narrowing AND de todas las dimensiones. Genérico sobre cualquier `T` que
 * cumpla `EnrichedParaFiltro` (el `Enriched` de `comex-cockpit.ts` lo satisface).
 * Con `filtros = {}` devuelve la lista intacta (no-op = PR-022a).
 */
export function aplicarFiltrosEnriched<T extends EnrichedParaFiltro>(
  items: T[],
  filtros: CockpitFiltros,
  ctx: AplicarCtx,
): T[] {
  return items.filter(
    (e) =>
      pasaProveedor(e, filtros) &&
      pasaEstado(e, filtros) &&
      pasaEta(e, filtros) &&
      pasaFoco(e, filtros, ctx),
  );
}
