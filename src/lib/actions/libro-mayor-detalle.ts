"use server";

/**
 * Wrapper CALL-only read-only del Libro Mayor por cuenta (CONT-02 · PR-028) —
 * espejo del patrón `getAsientoDetalle`: gate `auth()` + zod + serialización
 * Decimal→string. El motor `getLibroMayor` (reportes/libro-mayor.ts) se LLAMA,
 * jamás se modifica — incluida su convención de signo (`saldoPorCategoria`,
 * por categoría; el balance signa por naturaleza efectiva — divergencia
 * PRE-existente para regularizadoras, documentada en plan-cuentas-arbol.ts).
 *
 * Cap de display: la FWW embebida muestra hasta 500 líneas del rango
 * (mes-bounded por default); `truncado`/`totalLineas` se exponen honestamente
 * con link al reporte completo (/reportes/libro-mayor). El documento de
 * origen por asiento sale de `documentosOrigenPorAsiento` (reuso batch, sin
 * N+1 — paridad con la página de reportes). El historial de la cuenta es
 * `getAuditLog("CuentaContable", id)` — HOY sin writers (no hay CRUD de
 * cuenta): empty-state honesto.
 */

import { z } from "zod";

import { auth } from "@/lib/auth";
import { documentosOrigenPorAsiento, type DocumentoOrigen } from "@/lib/services/bi-drill-down";
import { getAuditLog, type AuditEntry } from "@/lib/services/auditoria";
import { getLibroMayor, LibroMayorError } from "@/lib/services/reportes";

const LM_MAX_LINEAS = 500;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const inputSchema = z.object({
  cuentaId: z.number().int().positive(),
  desde: z.string().regex(DATE_RE).optional(),
  hasta: z.string().regex(DATE_RE).optional(),
});

export type LibroMayorLineaDetalle = {
  lineaId: number;
  /** ISO yyyy-mm-dd. */
  fecha: string;
  asientoId: string;
  asientoNumero: number;
  asientoDescripcion: string;
  descripcion: string | null;
  debe: string;
  haber: string;
  saldoAcumulado: string;
  doc: DocumentoOrigen | null;
};

export type LibroMayorDetalle = {
  cuenta: { id: number; codigo: string; nombre: string; categoria: string };
  rango: { desde: string | null; hasta: string | null };
  saldoInicial: string;
  totalDebe: string;
  totalHaber: string;
  saldoFinal: string;
  saldoUsdFinal: string | null;
  lineas: LibroMayorLineaDetalle[];
  truncado: boolean;
  totalLineas: number;
  historial: AuditEntry[];
};

export type GetLibroMayorDetalleResult =
  | { ok: true; detalle: LibroMayorDetalle }
  | { ok: false; error: string };

function parseDesde(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseHasta(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

type MayorResult = Awaited<ReturnType<typeof getLibroMayor>>;

function rangoDe(data: { desde?: string; hasta?: string }): {
  desde: string | null;
  hasta: string | null;
} {
  return { desde: data.desde ?? null, hasta: data.hasta ?? null };
}

/** Serialización Decimal→string del rango consultado (display de la FWW). */
function serializarDetalle(
  mayor: MayorResult,
  rango: { desde: string | null; hasta: string | null },
  docs: Map<string, DocumentoOrigen | null>,
  historial: AuditEntry[],
): LibroMayorDetalle {
  const visibles = mayor.lineas.slice(0, LM_MAX_LINEAS);
  return {
    cuenta: {
      id: mayor.cuenta.id,
      codigo: mayor.cuenta.codigo,
      nombre: mayor.cuenta.nombre,
      categoria: mayor.cuenta.categoria,
    },
    rango,
    saldoInicial: mayor.saldoInicial.toFixed(2),
    totalDebe: mayor.totalDebe.toFixed(2),
    totalHaber: mayor.totalHaber.toFixed(2),
    saldoFinal: mayor.saldoFinal.toFixed(2),
    saldoUsdFinal: mayor.saldoUsdFinal ? mayor.saldoUsdFinal.toFixed(2) : null,
    lineas: visibles.map((l) => ({
      lineaId: l.lineaId,
      fecha: l.fecha.toISOString().slice(0, 10),
      asientoId: l.asientoId,
      asientoNumero: l.asientoNumero,
      asientoDescripcion: l.asientoDescripcion,
      descripcion: l.descripcion,
      debe: l.debe.toFixed(2),
      haber: l.haber.toFixed(2),
      saldoAcumulado: l.saldoAcumulado.toFixed(2),
      doc: docs.get(l.asientoId) ?? null,
    })),
    truncado: mayor.lineas.length > visibles.length,
    totalLineas: mayor.lineas.length,
    historial,
  };
}

export async function getLibroMayorDetalle(input: {
  cuentaId: number;
  desde?: string;
  hasta?: string;
}): Promise<GetLibroMayorDetalleResult> {
  const session = await auth();
  if (!session) {
    return { ok: false, error: "No autorizado." };
  }

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos." };
  }

  const fechaDesde = parseDesde(parsed.data.desde);
  const fechaHasta = parseHasta(parsed.data.hasta);

  try {
    const mayor = await getLibroMayor(parsed.data.cuentaId, { fechaDesde, fechaHasta });

    const visibles = mayor.lineas.slice(0, LM_MAX_LINEAS);
    const [docs, historial] = await Promise.all([
      documentosOrigenPorAsiento(visibles.map((l) => l.asientoId)),
      getAuditLog("CuentaContable", String(parsed.data.cuentaId)),
    ]);

    return { ok: true, detalle: serializarDetalle(mayor, rangoDe(parsed.data), docs, historial) };
  } catch (err) {
    if (err instanceof LibroMayorError) {
      return { ok: false, error: err.message };
    }
    console.error("getLibroMayorDetalle failed", err);
    return { ok: false, error: "Error inesperado al cargar el libro mayor." };
  }
}
