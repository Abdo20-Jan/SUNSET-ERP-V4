import "server-only";

import { db } from "@/lib/db";
import {
  AsientoEstado,
  AsientoOrigen,
  type Moneda,
  type PeriodoEstado,
  type Prisma,
} from "@/generated/prisma/client";
import { documentosOrigenPorAsiento, type DocumentoOrigen } from "@/lib/services/bi-drill-down";
import type { AsientosVista } from "@/app/(dashboard)/contabilidad/asientos/asientos-presentacion";

/**
 * Proyección read-only de la worklist de asientos (CONT-01 · PR-028).
 *
 * ADITIVA: el select es el MISMO de la page legada (`asientos/page.tsx`) +
 * `periodo.estado` (badge "Cerrado" display-only) + el documento de origen
 * resuelto en LOTE por `documentosOrigenPorAsiento` (bi-drill-down, reuso —
 * jamás se re-deriva). El motor de asientos (`asiento-automatico.ts`) no se
 * importa ni se toca: esto es SÓLO lectura para display/export.
 *
 * Vistas oficiales = presets `?vista=` server-side (lección PR-010). Partición
 * limpia por origen: manuales ∪ automaticos ∪ comex ∪ ajustes = todos;
 * `anulados` es un corte por estado ORTOGONAL (las vistas por origen no
 * filtran estado — los anulados aparecen tachados, como hoy). Alternativa
 * `automaticos ⊇ comex` descartada a propósito (cambiar = 1 línea + 1 test).
 */

/** Cap de filas del fetch período-bounded (espejo del cap de AUD-01/PR-010). */
export const ASIENTOS_WORKLIST_MAX = 2000;

export type AsientoWorklistRow = {
  id: string;
  numero: number;
  /** ISO — serializable al client component del grid. */
  fecha: string;
  periodoCodigo: string;
  periodoEstado: PeriodoEstado;
  origen: AsientoOrigen;
  descripcion: string;
  moneda: Moneda;
  totalDebe: string;
  totalHaber: string;
  estado: AsientoEstado;
  /** Documento de origen (bi-drill-down) — null = manual/sin ruta. */
  doc: DocumentoOrigen | null;
};

export type AsientosWorklistFiltros = {
  vista: AsientosVista;
  periodoId?: number;
  fechaDesde?: Date;
  fechaHasta?: Date;
  /** Asientos que TOCAN la cuenta (lineas.some — usa @@index([cuentaId])). */
  cuentaId?: number;
};

export type AsientosWorklistResult = {
  rows: AsientoWorklistRow[];
  /** Total de filas que matchean el where (puede exceder el cap). */
  total: number;
  truncado: boolean;
  /** Conteos por estado sobre período/fechas/cuenta SIN vista (canon fin-cxc). */
  kpis: { borradores: number; contabilizados: number; anulados: number };
};

/** Fragmento de `where` de cada vista oficial (server-side). */
export function whereDeVista(vista: AsientosVista): Prisma.AsientoWhereInput {
  switch (vista) {
    case "manuales":
      return { origen: AsientoOrigen.MANUAL };
    case "automaticos":
      return { origen: { in: [AsientoOrigen.TESORERIA, AsientoOrigen.GASTO] } };
    case "comex":
      return { origen: AsientoOrigen.COMEX };
    case "ajustes":
      return { origen: AsientoOrigen.AJUSTE };
    case "anulados":
      return { estado: AsientoEstado.ANULADO };
    default:
      return {};
  }
}

/** Composición del `where` completo (vista + período + fechas + cuenta). */
export function buildWhereAsientos(f: AsientosWorklistFiltros): Prisma.AsientoWhereInput {
  const where: Prisma.AsientoWhereInput = { ...whereDeVista(f.vista) };
  if (f.periodoId !== undefined) where.periodoId = f.periodoId;
  if (f.fechaDesde || f.fechaHasta) {
    where.fecha = {
      ...(f.fechaDesde && { gte: f.fechaDesde }),
      ...(f.fechaHasta && { lte: f.fechaHasta }),
    };
  }
  if (f.cuentaId !== undefined) where.lineas = { some: { cuentaId: f.cuentaId } };
  return where;
}

/**
 * Período default de la worklist resuelto contra la BD: el que contiene
 * `hoy`; fallback = el más reciente por fechaInicio (mismo criterio que
 * `resolverPeriodoDefault` de la presentación — la page lo resuelve sobre la
 * lista ya cargada; el EXPORT usa este helper para espejar el default cuando
 * la URL no trae `?periodo=`). `undefined` = sin períodos (sin filtro).
 */
export async function periodoDefaultId(hoy: Date): Promise<number | undefined> {
  const actual = await db.periodoContable.findFirst({
    where: { fechaInicio: { lte: hoy }, fechaFin: { gte: hoy } },
    select: { id: true },
  });
  if (actual) return actual.id;
  const reciente = await db.periodoContable.findFirst({
    orderBy: { fechaInicio: "desc" },
    select: { id: true },
  });
  return reciente?.id;
}

type GrupoEstado = { estado: AsientoEstado; _count: { _all: number } };

function contarEstado(grupos: GrupoEstado[], estado: AsientoEstado): number {
  return grupos.find((g) => g.estado === estado)?._count._all ?? 0;
}

export async function listarAsientosWorklist(
  filtros: AsientosWorklistFiltros,
): Promise<AsientosWorklistResult> {
  const where = buildWhereAsientos(filtros);
  // KPIs sobre TODAS las filas del período/cuenta — la vista sólo filtra el
  // grid (espejo fin-cxc: "KPIs sobre todas las filas").
  const whereSinVista = buildWhereAsientos({ ...filtros, vista: "todos" });

  const [asientos, total, porEstado] = await Promise.all([
    db.asiento.findMany({
      where,
      orderBy: [{ fecha: "desc" }, { numero: "desc" }],
      select: {
        id: true,
        numero: true,
        fecha: true,
        descripcion: true,
        estado: true,
        origen: true,
        moneda: true,
        totalDebe: true,
        totalHaber: true,
        periodo: { select: { codigo: true, estado: true } },
      },
      take: ASIENTOS_WORKLIST_MAX,
    }),
    db.asiento.count({ where }),
    db.asiento.groupBy({
      by: ["estado"],
      where: whereSinVista,
      _count: { _all: true },
    }),
  ]);

  const docs = await documentosOrigenPorAsiento(asientos.map((a) => a.id));

  const rows: AsientoWorklistRow[] = asientos.map((a) => ({
    id: a.id,
    numero: a.numero,
    fecha: a.fecha.toISOString(),
    periodoCodigo: a.periodo.codigo,
    periodoEstado: a.periodo.estado,
    origen: a.origen,
    descripcion: a.descripcion,
    moneda: a.moneda,
    totalDebe: a.totalDebe.toFixed(2),
    totalHaber: a.totalHaber.toFixed(2),
    estado: a.estado,
    doc: docs.get(a.id) ?? null,
  }));

  const grupos = porEstado as GrupoEstado[];

  return {
    rows,
    total,
    truncado: total > rows.length,
    kpis: {
      borradores: contarEstado(grupos, AsientoEstado.BORRADOR),
      contabilizados: contarEstado(grupos, AsientoEstado.CONTABILIZADO),
      anulados: contarEstado(grupos, AsientoEstado.ANULADO),
    },
  };
}
