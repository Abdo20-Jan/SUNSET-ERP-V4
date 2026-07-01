import "server-only";

import { type ContenedorEstado, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { isContenedorDesconsolidacionEnabled } from "@/lib/features";

type DbClient = Prisma.TransactionClient;

/**
 * Proyección de SÓLO LECTURA de la worklist GLOBAL de contenedores (PR-024 / CX-04).
 *
 * EXTENSIÓN ADITIVA: lee campos EXISTENTES de `Contenedor` + agrega los counters
 * de `ItemContenedor` (declarada/física/disponible/en despacho/despachada) vía un
 * único `groupBy` (sin N+1). NO llama ni reimplementa el motor de
 * desconsolidación/rateio/despacho (G-09 / CRIT-04..09): los counters se LEEN, nunca
 * se recalculan. Espelha el narrow-select de la worklist de embarques (CX-02):
 *
 *  - El `select` de contenedores NUNCA incluye campos monetarios.
 *  - `costoFCTotal` (USD) es una AGREGACIÓN DE DISPLAY de valores YA ALMACENADOS
 *    (`Σ costoFCUnitario × cantidadDeclarada`) — no toca el rateio ni persiste nada.
 *    Sólo se CONSULTA con `verCosto` (gate `VER_COSTO_LANDED`): sin permiso el costo
 *    NO se selecciona server-side y viaja como `null` (anti-leak, spec §9-estrutural 8).
 */

/** Fila de la worklist global de contenedores (11 columnas canónicas + contexto). */
export type ContenedorRow = {
  id: string;
  /** 1 · Número (ISO 6346). */
  numeroContenedor: string;
  /** 2 · BL / HBL. */
  numeroBL: string | null;
  numeroHBL: string | null;
  /** 3 · Status. */
  estado: ContenedorEstado;
  /** 4 · Fecha salida (origen). */
  fechaSalidaOrigen: string | null;
  /** 5 · Fecha llegada (puerto). */
  fechaLlegadaPuerto: string | null;
  /** 6 · Depósito fiscal (nombre). */
  depositoFiscal: string | null;
  /** 7-11 · Counters agregados del packing list (LEÍDOS del motor, nunca recalculados). */
  cantidadDeclarada: number;
  cantidadFisica: number;
  cantidadDisponible: number;
  cantidadEnDespacho: number;
  cantidadDespachada: number;
  /** Contexto para búsqueda/filtros/links (no columnas monetarias). */
  embarqueId: string;
  embarqueCodigo: string;
  proveedorNombre: string;
  /**
   * Costo FC total (USD) = Σ `costoFCUnitario` × `cantidadDeclarada` de valores
   * almacenados. `null` cuando el caller no tiene `VER_COSTO_LANDED` (el costo NO
   * se consulta server-side). Sólo para la mini-ficha de drill-down.
   */
  costoFCTotal: string | null;
};

export type ContenedorWorklistFiltros = {
  estado?: ContenedorEstado;
  proveedorId?: string;
  depositoFiscalId?: string;
  embarqueId?: string;
  perPage?: number;
  /** Resuelto por el caller (page) con `hasPermission(VER_COSTO_LANDED)`. */
  verCosto: boolean;
};

export type ContenedoresWorklistPage = {
  rows: ContenedorRow[];
  total: number;
};

const CONT_WORKLIST_MAX = 2000;

// Narrow select: SIN campos monetarios (`costoFCUnitario` NUNCA acá). El costo se
// resuelve aparte y sólo con permiso (ver `costoFCPorContenedor`).
const contenedorSelect = {
  id: true,
  numeroContenedor: true,
  numeroBL: true,
  numeroHBL: true,
  estado: true,
  fechaSalidaOrigen: true,
  fechaLlegadaPuerto: true,
  embarqueId: true,
  depositoFiscal: { select: { nombre: true } },
  embarque: { select: { codigo: true, proveedor: { select: { nombre: true } } } },
} satisfies Prisma.ContenedorSelect;

type ContenedorRecord = Prisma.ContenedorGetPayload<{ select: typeof contenedorSelect }>;

/** Suma agregada de los counters de `ItemContenedor` por contenedor (`_sum`). */
type SumasContador = {
  cantidadDeclarada: number | null;
  cantidadFisica: number | null;
  cantidadDisponible: number | null;
  cantidadEnDespacho: number | null;
  cantidadDespachada: number | null;
};

function construirWhere(f: ContenedorWorklistFiltros): Prisma.ContenedorWhereInput {
  const where: Prisma.ContenedorWhereInput = {};
  if (f.estado) where.estado = f.estado;
  if (f.embarqueId) where.embarqueId = f.embarqueId;
  if (f.depositoFiscalId) where.depositoFiscalId = f.depositoFiscalId;
  if (f.proveedorId) where.embarque = { proveedorId: f.proveedorId };
  return where;
}

function mapContenedorRow(
  c: ContenedorRecord,
  sums: SumasContador | undefined,
  costoFCTotal: string | null,
): ContenedorRow {
  return {
    id: c.id,
    numeroContenedor: c.numeroContenedor,
    numeroBL: c.numeroBL,
    numeroHBL: c.numeroHBL,
    estado: c.estado,
    fechaSalidaOrigen: c.fechaSalidaOrigen ? c.fechaSalidaOrigen.toISOString() : null,
    fechaLlegadaPuerto: c.fechaLlegadaPuerto ? c.fechaLlegadaPuerto.toISOString() : null,
    depositoFiscal: c.depositoFiscal?.nombre ?? null,
    cantidadDeclarada: sums?.cantidadDeclarada ?? 0,
    cantidadFisica: sums?.cantidadFisica ?? 0,
    cantidadDisponible: sums?.cantidadDisponible ?? 0,
    cantidadEnDespacho: sums?.cantidadEnDespacho ?? 0,
    cantidadDespachada: sums?.cantidadDespachada ?? 0,
    embarqueId: c.embarqueId,
    embarqueCodigo: c.embarque.codigo,
    proveedorNombre: c.embarque.proveedor.nombre,
    costoFCTotal,
  };
}

/**
 * Costo FC total por contenedor (USD). Agregación de DISPLAY de valores ALMACENADOS
 * (`costoFCUnitario` poblado por el rateio al cerrar costos). NO llama al motor ni
 * persiste. Se invoca SÓLO con `verCosto` — así el costo nunca se consulta sin
 * permiso (anti-leak server-side).
 */
async function costoFCPorContenedor(
  client: DbClient,
  where: Prisma.ContenedorWhereInput,
): Promise<Map<string, string>> {
  const items = await client.itemContenedor.findMany({
    where: { contenedor: where },
    select: { contenedorId: true, costoFCUnitario: true, cantidadDeclarada: true },
  });
  const acc = new Map<string, Prisma.Decimal>();
  for (const it of items) {
    if (it.costoFCUnitario == null) continue;
    const parcial = it.costoFCUnitario.mul(it.cantidadDeclarada);
    const prev = acc.get(it.contenedorId);
    acc.set(it.contenedorId, prev ? prev.add(parcial) : parcial);
  }
  const out = new Map<string, string>();
  for (const [id, dec] of acc) out.set(id, dec.toFixed(2));
  return out;
}

/**
 * Lectura de la worklist GLOBAL de contenedores (PR-024 / CX-04). Sólo lectura:
 * proyecta campos existentes + agrega counters. NO consume/reimplementa el motor.
 */
export async function listarContenedores(
  filtros: ContenedorWorklistFiltros,
  tx?: DbClient,
): Promise<ContenedoresWorklistPage> {
  // Inercia total con la flag apagada: NINGUNA query corre (defensa en profundidad
  // además del gate de la page). Cero regresión sobre el ERP legado.
  if (!isContenedorDesconsolidacionEnabled()) return { rows: [], total: 0 };

  const client: DbClient = tx ?? db;
  const where = construirWhere(filtros);
  const take = Math.max(
    1,
    Math.min(CONT_WORKLIST_MAX, Math.floor(filtros.perPage ?? CONT_WORKLIST_MAX)),
  );

  const [contenedores, total, sums] = await Promise.all([
    client.contenedor.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      select: contenedorSelect,
    }),
    client.contenedor.count({ where }),
    client.itemContenedor.groupBy({
      by: ["contenedorId"],
      where: { contenedor: where },
      _sum: {
        cantidadDeclarada: true,
        cantidadFisica: true,
        cantidadDisponible: true,
        cantidadEnDespacho: true,
        cantidadDespachada: true,
      },
    }),
  ]);

  const sumsById = new Map(sums.map((s) => [s.contenedorId, s._sum]));
  // Costo FC: sólo se CONSULTA con permiso (anti-leak server-side).
  const costoById = filtros.verCosto ? await costoFCPorContenedor(client, where) : null;

  const rows = contenedores.map((c) =>
    mapContenedorRow(c, sumsById.get(c.id), costoById?.get(c.id) ?? null),
  );
  return { rows, total };
}
