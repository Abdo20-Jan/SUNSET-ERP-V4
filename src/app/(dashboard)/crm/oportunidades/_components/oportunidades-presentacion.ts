/**
 * Helpers PUROS de presentación de la worklist/record de oportunidades
 * (CRM-01 · PR-030). Client-safe y sin JSX — importables desde la page RSC,
 * los componentes client y la export action (idioma de
 * `pedidos-compra-presentacion.ts` / `fin-cxc-presentacion.ts`).
 *
 * READ-ONLY: proyecta lo que `listarOportunidades` YA devuelve e inyecta la
 * "próxima acción" derivada de las actividades pendientes (servicio
 * `crm-proxima-accion`, corrido aparte por la page/export). El valor
 * ponderado (monto × probabilidad/100) es DISPLAY-ONLY — decimal exacto
 * (decimal.js, mismo idioma que compras/pedidos), NUNCA float. Las sub-vistas
 * oficiales son presets de URL server-side (lección PR-010).
 */

import Decimal from "decimal.js";

import { convertirMonto } from "@/lib/format";
import { OPORTUNIDAD_ESTADOS } from "@/lib/crm-enums";
import type { listarOportunidades } from "@/lib/actions/oportunidades";
import type { ExportColumn } from "@/lib/export/types";
import type { ActividadPendienteRow } from "@/lib/services/crm-proxima-accion";
import type { OportunidadEstado } from "@/generated/prisma/client";

import { buildNombre } from "../pipeline/_helpers";

// Tipo derivado de la action (misma técnica de `pipeline/_helpers.ts`):
// import type-only → cero runtime del módulo "use server" en el client.
export type OportunidadRow = Awaited<ReturnType<typeof listarOportunidades>>[number];

export type { ActividadPendienteRow };

export type ProximaAccion = {
  fecha: Date | null;
  tipo: string;
  contenido: string;
};

export type OportunidadWorklistRow = OportunidadRow & {
  proximaAccion: ProximaAccion | null;
  valorPonderado: string;
};

type MonedaPres = "ARS" | "USD";

/**
 * Valor ponderado = monto × probabilidad / 100, decimal exacto a 2 decimales
 * (half-up). DISPLAY-ONLY: no persiste ni entra a ningún asiento.
 */
export function calcularValorPonderado(monto: string, probabilidad: number): string {
  return new Decimal(monto).times(probabilidad).div(100).toFixed(2);
}

/**
 * Primera actividad pendiente por oportunidad (first-wins: el servicio ya
 * ordena fechaProgramada asc nulls-last). Defensivo ante un orden inesperado:
 * una candidata CON fecha desplaza a una ya mapeada SIN fecha.
 */
export function derivarProximaAccionPorOportunidad(
  pendientes: ActividadPendienteRow[],
): Map<string, ProximaAccion> {
  const map = new Map<string, ProximaAccion>();
  for (const a of pendientes) {
    const candidata: ProximaAccion = {
      fecha: a.fechaProgramada,
      tipo: a.tipo,
      contenido: a.contenido,
    };
    const actual = map.get(a.oportunidadId);
    if (!actual) {
      map.set(a.oportunidadId, candidata);
      continue;
    }
    if (actual.fecha === null && candidata.fecha !== null) {
      map.set(a.oportunidadId, candidata);
    }
  }
  return map;
}

/**
 * Arma las filas del grid 1:1 (conservación: mismas filas, mismo orden que la
 * action) anexando próxima acción (`null` si la oportunidad no tiene
 * pendientes) y valor ponderado.
 */
export function armarWorklistRows(
  ops: OportunidadRow[],
  proximas: ReadonlyMap<string, ProximaAccion>,
): OportunidadWorklistRow[] {
  return ops.map((o) => ({
    ...o,
    proximaAccion: proximas.get(o.id) ?? null,
    valorPonderado: calcularValorPonderado(o.monto, o.probabilidad),
  }));
}

// ---------------------------------------------------------------------------
// Presets de URL (vista / filtro / estado) — server-side, lección PR-010.
// ---------------------------------------------------------------------------

export type OportunidadesVista = "lista" | "tablero";

export function resolverVista(param: string | undefined): OportunidadesVista {
  if (param === "tablero") return "tablero";
  return "lista";
}

export type OportunidadesFiltro = "todas" | "sin_accion";

export function resolverFiltro(param: string | undefined): OportunidadesFiltro {
  if (param === "sin_accion") return "sin_accion";
  return "todas";
}

/**
 * "Sin próxima acción" = oportunidad ABIERTA sin NINGUNA actividad pendiente.
 * Una pendiente SIN fecha programada CUENTA como tener próxima acción (hay
 * seguimiento, sólo falta agendar). Se restringe a ABIERTA: las cerradas
 * (GANADA/PERDIDA) no tienen pendientes por naturaleza y ahogarían el preset.
 */
export function filtrarSinAccion(rows: OportunidadWorklistRow[]): OportunidadWorklistRow[] {
  return rows.filter(esSinAccion);
}

function esSinAccion(r: OportunidadWorklistRow): boolean {
  return r.estado === "ABIERTA" && r.proximaAccion === null;
}

/**
 * Lógica exacta del `parseEstado` que vivía en la page (movido acá para que
 * page y export compartan el MISMO parser). Fuente de valores:
 * `OPORTUNIDAD_ESTADOS` (crm-enums) — literales tipados contra el enum, sin
 * import de valor del client de Prisma en un módulo client-safe.
 */
export function parseEstadoParam(v: string | undefined): OportunidadEstado | undefined {
  if (!v) return undefined;
  return (OPORTUNIDAD_ESTADOS as readonly string[]).includes(v)
    ? (v as OportunidadEstado)
    : undefined;
}

const BASE_HREF = "/crm/oportunidades";

/**
 * Href canónico de la worklist: omite defaults (vista=lista, filtro=todas) y
 * fija un orden estable de params (vista · estado · filtro · owner · moneda).
 * `URLSearchParams` escapa los valores (lección CodeQL PR-028).
 */
export function buildOportunidadesHref(opts: {
  vista?: OportunidadesVista;
  estado?: string;
  filtro?: OportunidadesFiltro;
  owner?: string;
  moneda?: string;
}): string {
  const qp = new URLSearchParams();
  if (opts.vista && opts.vista !== "lista") qp.set("vista", opts.vista);
  if (opts.estado) qp.set("estado", opts.estado);
  if (opts.filtro && opts.filtro !== "todas") qp.set("filtro", opts.filtro);
  if (opts.owner) qp.set("owner", opts.owner);
  if (opts.moneda) qp.set("moneda", opts.moneda);
  const qs = qp.toString();
  return qs ? `${BASE_HREF}?${qs}` : BASE_HREF;
}

// ---------------------------------------------------------------------------
// Derivaciones del record (sobre las actividades de `getOportunidad`).
// ---------------------------------------------------------------------------

export type ActividadDeOportunidad = {
  tipo: string;
  contenido: string;
  completada: boolean;
  fechaProgramada: Date | null;
  fechaCompletada: Date | null;
};

/** Pendiente (completada=false) con MENOR fechaProgramada; con-fecha vence sin-fecha. */
export function derivarProximaAccionDeActividades(
  acts: ActividadDeOportunidad[],
): ProximaAccion | null {
  let mejor: ProximaAccion | null = null;
  for (const a of acts) {
    if (a.completada) continue;
    const candidata: ProximaAccion = {
      fecha: a.fechaProgramada,
      tipo: a.tipo,
      contenido: a.contenido,
    };
    if (!mejor || esFechaMenor(candidata.fecha, mejor.fecha)) mejor = candidata;
  }
  return mejor;
}

function esFechaMenor(a: Date | null, b: Date | null): boolean {
  if (a === null) return false;
  if (b === null) return true;
  return a.getTime() < b.getTime();
}

/** Completada (completada=true) con MAYOR fechaCompletada. */
export function derivarUltimoContacto(acts: ActividadDeOportunidad[]): ProximaAccion | null {
  let ultimo: ProximaAccion | null = null;
  let ultimaFecha: number | null = null;
  for (const a of acts) {
    if (!a.completada || a.fechaCompletada === null) continue;
    const t = a.fechaCompletada.getTime();
    if (ultimaFecha === null || t > ultimaFecha) {
      ultimaFecha = t;
      ultimo = { fecha: a.fechaCompletada, tipo: a.tipo, contenido: a.contenido };
    }
  }
  return ultimo;
}

// ---------------------------------------------------------------------------
// Proyección para el export auditado (native-first, lección #262/#263).
// ---------------------------------------------------------------------------

export type FilaExportOportunidad = {
  numero: string;
  titulo: string;
  vinculo: string;
  monedaNativa: string;
  montoNativo: string;
  montoPres: string;
  stage: string;
  probabilidad: number;
  ponderadoNativo: string;
  ponderadoPres: string;
  estado: string;
  owner: string;
  proximaAccion: string;
  cierreEstimado: string;
  creada: string;
};

/** Fecha → YYYY-MM-DD ("" cuando falta). */
function isoDia(fecha: Date | null): string {
  if (!fecha) return "";
  return fecha.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD · TIPO" — sólo el tipo si la pendiente no tiene fecha; "" sin pendientes. */
function proximaAccionExport(p: ProximaAccion | null): string {
  if (!p) return "";
  if (!p.fecha) return p.tipo;
  return `${p.fecha.toISOString().slice(0, 10)} · ${p.tipo}`;
}

/**
 * Native-first: el monto/ponderado NATIVO va intacto al archivo + la columna
 * de presentación convertida por fila con `convertirMonto` (mismo helper que
 * los exports espejo — nunca se divide por TC a mano).
 */
export function proyectarFilaOportunidad(
  r: OportunidadWorklistRow,
  moneda: MonedaPres,
  tc: string | null,
): FilaExportOportunidad {
  return {
    numero: r.numero,
    titulo: r.titulo,
    vinculo: buildNombre(r),
    monedaNativa: r.moneda,
    montoNativo: r.monto,
    montoPres: convertirMonto(r.monto, r.moneda, moneda, tc),
    stage: r.stageNombre,
    probabilidad: r.probabilidad,
    ponderadoNativo: r.valorPonderado,
    ponderadoPres: convertirMonto(r.valorPonderado, r.moneda, moneda, tc),
    estado: r.estado,
    owner: r.ownerNombre,
    proximaAccion: proximaAccionExport(r.proximaAccion),
    cierreEstimado: isoDia(r.cierreEstimado),
    creada: isoDia(r.createdAt),
  };
}

export function buildColumnasExportOportunidades(
  moneda: MonedaPres,
): ExportColumn<FilaExportOportunidad>[] {
  return [
    { header: "N°", value: (r) => r.numero },
    { header: "Título", value: (r) => r.titulo },
    { header: "Cliente/Lead", value: (r) => r.vinculo },
    { header: "Moneda", value: (r) => r.monedaNativa },
    { header: "Monto nativo", value: (r) => r.montoNativo },
    { header: `Monto (${moneda})`, value: (r) => r.montoPres },
    { header: "Stage", value: (r) => r.stage },
    { header: "Probabilidad %", value: (r) => r.probabilidad },
    { header: "Ponderado nativo", value: (r) => r.ponderadoNativo },
    { header: `Ponderado (${moneda})`, value: (r) => r.ponderadoPres },
    { header: "Estado", value: (r) => r.estado },
    { header: "Owner", value: (r) => r.owner },
    { header: "Próxima acción", value: (r) => r.proximaAccion },
    { header: "Cierre estimado", value: (r) => r.cierreEstimado },
    { header: "Creada", value: (r) => r.creada },
  ];
}
