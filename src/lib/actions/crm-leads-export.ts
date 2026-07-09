"use server";

/**
 * Exportación AUDITADA de la worklist de leads (CRM-01 · PR-030). Mirror de
 * `compras-export.ts` (PR-029): re-lee server-side la MISMA página visible —
 * mismos parsers de vista/filtros/paginación que la page (paridad vía los
 * helpers compartidos de `leads-presentacion.ts`) — deriva el seguimiento con
 * los MISMOS helpers puros, serializa CSV/XLSX y registra un evento
 * EXPORTACION (meta-auditoría; si falla, propaga — no se entrega el archivo
 * sin registrar).
 *
 * Gate: `requireCrmAuth()` (flag CRM_ENABLED + sesión) — no existe chave de
 * permiso CRM hoy, no se inventa una.
 *
 * Superficie de import DELIBERADAMENTE restringida a lectura + presentación +
 * serialización + auditoría: NUNCA importa actions de mutación.
 */

import {
  derivarSeguimiento,
  flattenLeads,
  type LeadWorklistRow,
  type LeadsVista,
  parseLeadEstado,
  parseLeadFuente,
  resolverVista,
} from "@/app/(dashboard)/crm/leads/_components/leads-presentacion";
import { parsePaginationParams } from "@/components/ui/pagination-params";
import type { LeadEstado, LeadFuente } from "@/generated/prisma/client";
import { requireCrmAuth } from "@/lib/actions/_crm-helpers";
import { listarLeads, type LeadRow } from "@/lib/actions/leads";
import { toCsv } from "@/lib/export/csv";
import type { ExportColumn } from "@/lib/export/types";
import { toXlsx } from "@/lib/export/xlsx";
import { auditarExportacion } from "@/lib/services/auditar-exportacion";
import {
  cargarActividadesSeguimiento,
  listarLeadsSinFollowUp,
} from "@/lib/services/crm/lead-seguimiento";

type Formato = "csv" | "xlsx";

type LeadsExportParams = {
  vista?: string;
  q?: string;
  estado?: string;
  fuente?: string;
  page?: string;
  perPage?: string;
};

export type ExportarLeadsResult =
  | { ok: true; filename: string; mime: string; base64: string }
  | { ok: false; error: string };

const CSV_MIME = "text/csv;charset=utf-8";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Fila proyectada para el archivo. */
type FilaExport = {
  nombre: string;
  empresa: string;
  cuit: string;
  email: string;
  telefono: string;
  fuente: string;
  estado: string;
  score: string;
  proximaAccion: string;
  ultimoContacto: string;
  owner: string;
  cliente: string;
  creado: string;
};

/** Fecha ISO → YYYY-MM-DD ("" cuando falta). */
function isoDia(fecha: string | null): string {
  if (!fecha) return "";
  return fecha.slice(0, 10);
}

function juntarFechaTipo(dia: string, tipo: string | null): string {
  if (!tipo) return dia;
  return `${dia} (${tipo})`;
}

// Misma semántica que la celda del grid: pendiente sin fecha → texto fijo;
// sin pendiente → "".
function proximaAccionExport(f: LeadWorklistRow): string {
  if (!f.tienePendiente) return "";
  if (!f.proximaAccionFecha) return "Pendiente sin fecha";
  return juntarFechaTipo(isoDia(f.proximaAccionFecha), f.proximaAccionTipo);
}

function ultimoContactoExport(f: LeadWorklistRow): string {
  if (!f.ultimoContactoFecha) return "";
  return juntarFechaTipo(isoDia(f.ultimoContactoFecha), f.ultimoContactoTipo);
}

/** null → "" (helper nombrado — CCN baja, sin `??` en el object literal). */
function vacioSiNull(v: string | null): string {
  if (v === null) return "";
  return v;
}

function toFilaExport(f: LeadWorklistRow): FilaExport {
  return {
    nombre: f.nombre,
    empresa: vacioSiNull(f.empresa),
    cuit: vacioSiNull(f.cuit),
    email: vacioSiNull(f.email),
    telefono: vacioSiNull(f.telefono),
    fuente: f.fuente,
    estado: f.estado,
    score: String(f.score),
    proximaAccion: proximaAccionExport(f),
    ultimoContacto: ultimoContactoExport(f),
    owner: f.ownerNombre,
    cliente: vacioSiNull(f.clienteNombre),
    creado: isoDia(f.createdAt),
  };
}

function buildColumnas(): ExportColumn<FilaExport>[] {
  return [
    { header: "Nombre", value: (r) => r.nombre },
    { header: "Empresa", value: (r) => r.empresa },
    { header: "CUIT", value: (r) => r.cuit },
    { header: "Email", value: (r) => r.email },
    { header: "Teléfono", value: (r) => r.telefono },
    { header: "Fuente", value: (r) => r.fuente },
    { header: "Estado", value: (r) => r.estado },
    { header: "Score", value: (r) => r.score },
    { header: "Próxima acción", value: (r) => r.proximaAccion },
    { header: "Último contacto", value: (r) => r.ultimoContacto },
    { header: "Owner", value: (r) => r.owner },
    { header: "Cliente", value: (r) => r.cliente },
    { header: "Creado", value: (r) => r.creado },
  ];
}

function selloFecha(): string {
  return new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
}

async function serializarExport(
  formato: Formato,
  columnas: ExportColumn<FilaExport>[],
  rows: FilaExport[],
): Promise<{ base64: string; mime: string; filename: string }> {
  const sello = selloFecha();
  if (formato === "xlsx") {
    const bytes = await toXlsx(columnas, rows, "Leads");
    return {
      base64: Buffer.from(bytes).toString("base64"),
      mime: XLSX_MIME,
      filename: `crm-leads-${sello}.xlsx`,
    };
  }
  const csv = toCsv(columnas, rows);
  return {
    base64: Buffer.from(csv, "utf8").toString("base64"),
    mime: CSV_MIME,
    filename: `crm-leads-${sello}.csv`,
  };
}

// MISMA carga condicional por vista que la page de leads: sin-follow-up →
// query propia del servicio; mios → `listarLeads` con ownerId de la sesión
// (presentación, no seguridad); todos → `listarLeads`.
async function cargarLeadsVista(
  vista: LeadsVista,
  ownerId: string,
  filtros: {
    estado?: LeadEstado;
    fuente?: LeadFuente;
    search?: string;
    page: number;
    perPage: number;
  },
): Promise<{ rows: LeadRow[]; total: number }> {
  if (vista === "sin-follow-up") return listarLeadsSinFollowUp(filtros);
  if (vista === "mios") return listarLeads({ ...filtros, ownerId });
  return listarLeads(filtros);
}

export async function exportarLeads(input: {
  params: LeadsExportParams;
  formato: Formato;
}): Promise<ExportarLeadsResult> {
  // Gate CRM + sesión (FK-safe para el evento de auditoría).
  const guard = await requireCrmAuth();
  if (!guard.ok) return { ok: false, error: guard.error };

  // MISMOS parsers que la page → misma página visible con los mismos presets.
  const vista = resolverVista(input.params.vista);
  const { page, perPage } = parsePaginationParams(input.params);
  const { rows } = await cargarLeadsVista(vista, guard.userId, {
    estado: parseLeadEstado(input.params.estado),
    fuente: parseLeadFuente(input.params.fuente),
    search: input.params.q,
    page,
    perPage,
  });

  // MISMOS helpers puros que la page (paridad grid ↔ archivo).
  const seguimiento = derivarSeguimiento(await cargarActividadesSeguimiento(rows.map((r) => r.id)));
  const filas = flattenLeads(rows, seguimiento, new Date());

  const rowsExport = filas.map(toFilaExport);
  const columnas = buildColumnas();
  const { base64, mime, filename } = await serializarExport(input.formato, columnas, rowsExport);

  // Meta-auditoría: si falla, propaga → no se entrega el archivo sin registrar.
  await auditarExportacion({
    recurso: "crm-leads",
    filtros: input.params,
    columnas: columnas.map((c) => c.header),
    nFilas: rowsExport.length,
    formato: input.formato,
  });

  return { ok: true, filename, mime, base64 };
}
