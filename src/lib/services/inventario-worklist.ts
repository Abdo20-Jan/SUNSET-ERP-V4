import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { DespachoEstado, TipoDeposito } from "@/generated/prisma/client";

import {
  type EnProduccionFila,
  type EnTransitoFila,
  listarEnProduccion,
  listarEnTransito,
} from "@/lib/actions/inventario";
import { db } from "@/lib/db";

/**
 * Proyección read-only de la worklist canónica de inventario
 * (INV-01 · PR-027): UNA fila por producto×depósito desde `StockPorDeposito`
 * (grano exacto — `@@unique([productoId, depositoId])`) + filas "pipeline"
 * sintéticas para productos SIN posición viva pero con unidades en tránsito /
 * producción (paridad con las tabs viejas, que eran product-level).
 *
 * UI-only + motor intocado (CRIT-09): este módulo NUNCA importa
 * `stock.ts` / `stock-recalc.ts` / `stock-helpers.ts` ni recalcula nada —
 * `costoPromedio` es el valor ALMACENADO por el motor, jamás re-derivado.
 * Las columnas derivadas (en fiscal / futuro comex / despachos activos) salen
 * de queries read-only batched (cero N+1): las agregaciones son Maps
 * in-memory sobre resultados ya traídos. `Producto.stockActual` (agregado
 * legacy) NO se usa: la fuente por depósito es siempre SPD, espejo de las
 * celdas de la matriz actual (paridad trabada por test). El criterio
 * "fiscal" es `tipo === ZONA_PRIMARIA` — EXACTAMENTE la partición del engine
 * (`replayStockNacional` salta sólo lo no-NACIONAL por tipo; nunca lee
 * subtipo), para que `totalFisicoNacional` espeje la semántica de
 * `stockActual` sin leerlo. Depósitos inactivos quedan FUERA (la matriz
 * vieja sólo renderizaba depósitos activos).
 *
 * Gate `VER_COSTO_STOCK` (consume-or-omit, espejo PR-024): el costo viaja en
 * una query SEPARADA que sin permiso NI SE EJECUTA — el valor no sale del SQL
 * y toda fila lleva `costoPromedio: null` (CRIT-10; la columna del grid ni se
 * construye). El boolean llega PRE-resuelto del caller (`puedeVerCostoStock()`
 * en la page / export action) — este módulo nunca importa permisos/auth.
 */

/** Corte del "Futuro Comex": ETA dentro de los próximos 90 días (OD-04 §4). */
const DIAS_CORTE_FUTURO_COMEX = 90;

/** Umbral del BADGE "sin movimiento" (la vista acepta `?dias=` aparte). */
const UMBRAL_ALERTA_SIN_MOVIMIENTO = 90;

/** Cap defensivo de filas (la matriz vieja cortaba en 100 productos). */
const CAP_FILAS = 10_000;

const MS_POR_DIA = 86_400_000;

/** Rótulo del "depósito" sintético de las filas pipeline (sin SPD viva). */
export const PIPELINE_DEPOSITO_LABEL = "En tránsito / producción";

export type FuturoComexResumen = {
  /** Unidades con ETA ≤ 90d (la COLUMNA Futuro Comex del OD-04). */
  total: number;
  enProduccion: number;
  enTransito: number;
  /** Totales SIN corte de ETA — semántica de las tabs viejas (vista [En tránsito]). */
  enTransitoTotal: number;
  enProduccionTotal: number;
};

export type InventarioAlerta = "negativo" | "bajo_minimo" | "sin_movimiento";

/** Etiquetas de la alerta (export/server; el grid define sus badges aparte). */
export const ALERTA_LABEL: Record<InventarioAlerta, string> = {
  negativo: "Stock negativo",
  bajo_minimo: "Bajo mínimo",
  sin_movimiento: "Sin movimiento",
};

export type InventarioWorklistRow = {
  /** `${productoId}:${depositoId}` — o `${productoId}:pipeline` (sintética). */
  id: string;
  productoId: string;
  codigo: string;
  nombre: string;
  marca: string | null;
  medida: string | null;
  stockMinimo: number;
  /** "" en las filas pipeline (sin depósito real — no navegable). */
  depositoId: string;
  depositoNombre: string;
  depositoFiscal: boolean;
  fisico: number;
  reservado: number;
  /** físico − reservado (fórmula de la matriz actual; conferencia sin modelo = 0). */
  disponible: number;
  /** SIEMPRE null sin `VER_COSTO_STOCK` (el valor ni sale del SQL). */
  costoPromedio: string | null;
  /** ISO — `SPD.ultimoMovimiento` (best-effort); null en filas pipeline. */
  ultimoMovimiento: string | null;
  sinMovimientoDias: number;
  /** Σ físico del MISMO producto en depósitos fiscales (repetido por fila). */
  enFiscal: number;
  fiscalBreakdown: { deposito: string; cantidad: number }[];
  futuroComex: FuturoComexResumen;
  despachosActivos: number;
  /** Σ físico NACIONAL del producto (semántica de `stockActual`, sin leerlo). */
  totalFisicoNacional: number;
  bajoMinimo: boolean;
  /** Alerta de mayor severidad (negativo > bajo mínimo > sin movimiento). */
  alerta: InventarioAlerta | null;
};

// ── Sub-vistas oficiales = presets de URL server-side (lección PR-010) ──────
// [Divergencias]/[Bloqueado]/[Reservado] del OD-04 NO tienen backing model —
// omitidas, no fabricadas (ver IMPLEMENTATION_NOTES_PR027).

export type InventarioVista =
  | "todas"
  | "bajo-minimo"
  | "negativos"
  | "en-transito"
  | "en-fiscal"
  | "futuro-comex"
  | "sin-movimiento";

const VISTAS_VALIDAS: readonly InventarioVista[] = [
  "todas",
  "bajo-minimo",
  "negativos",
  "en-transito",
  "en-fiscal",
  "futuro-comex",
  "sin-movimiento",
];

export function resolverVista(param: string | undefined): InventarioVista {
  return (VISTAS_VALIDAS as readonly string[]).includes(param ?? "")
    ? (param as InventarioVista)
    : "todas";
}

/** Whitelist del umbral de [Sin movimiento Xd] (`?dias=`). Default 90. */
export const DIAS_SIN_MOVIMIENTO = [30, 60, 90, 180] as const;

export function resolverDias(param: string | undefined): number {
  const n = Number(param);
  return (DIAS_SIN_MOVIMIENTO as readonly number[]).includes(n) ? n : UMBRAL_ALERTA_SIN_MOVIMIENTO;
}

/**
 * Filtra por preset. Puro — no re-deriva nada: lee campos ya proyectados.
 * [En tránsito] usa el total SIN corte (semántica de la tab vieja: un item
 * genuinamente en el agua con ETA > 90d sigue visible); el corte de 90d es
 * exclusivo de la COLUMNA/vista Futuro Comex (OD-04).
 */
export function filtrarPorVista(
  rows: InventarioWorklistRow[],
  vista: InventarioVista,
  dias: number,
): InventarioWorklistRow[] {
  if (vista === "bajo-minimo") return rows.filter((r) => r.bajoMinimo);
  if (vista === "negativos") return rows.filter((r) => r.fisico < 0 || r.disponible < 0);
  if (vista === "en-transito") return rows.filter((r) => r.futuroComex.enTransitoTotal > 0);
  if (vista === "en-fiscal") return rows.filter((r) => r.depositoFiscal || r.enFiscal > 0);
  if (vista === "futuro-comex") return rows.filter((r) => r.futuroComex.total > 0);
  if (vista === "sin-movimiento") return rows.filter((r) => r.sinMovimientoDias >= dias);
  return rows;
}

/**
 * Preset `?agrupar=deposito`: reordena las MISMAS filas contiguas por depósito
 * (presentación pura — mismo multiset, mismos totales; trabado por test). El
 * orden default del servicio es producto-céntrico (codigo, depósito).
 */
export function ordenarPorDeposito(rows: InventarioWorklistRow[]): InventarioWorklistRow[] {
  return [...rows].sort(
    (a, b) =>
      a.depositoNombre.localeCompare(b.depositoNombre) ||
      a.codigo.localeCompare(b.codigo) ||
      a.id.localeCompare(b.id),
  );
}

// ── Derivaciones puras (helpers chicos — gate Codacy CCN ≤ 8) ───────────────

/**
 * Partición nacional/fiscal por `tipo` SOLAMENTE — espejo exacto del engine
 * (`replayStockNacional` cuenta todo depósito NACIONAL; nunca lee subtipo).
 */
function esDepositoFiscal(tipo: TipoDeposito): boolean {
  return tipo === TipoDeposito.ZONA_PRIMARIA;
}

type ProductoMeta = {
  codigo: string;
  nombre: string;
  marca: string | null;
  medida: string | null;
  stockMinimo: number;
};

type SpdRow = {
  productoId: string;
  depositoId: string;
  cantidadFisica: number;
  cantidadReservada: number;
  ultimoMovimiento: Date;
  producto: ProductoMeta;
  deposito: { nombre: string; tipo: TipoDeposito };
};

type AgregadoProducto = {
  totalFisicoNacional: number;
  enFiscal: number;
  fiscalBreakdown: { deposito: string; cantidad: number }[];
};

/** Σ por producto: físico NACIONAL (bajo mínimo) + fiscal con breakdown. */
function agregadosPorProducto(spd: SpdRow[]): Map<string, AgregadoProducto> {
  const out = new Map<string, AgregadoProducto>();
  for (const s of spd) {
    const agg = out.get(s.productoId) ?? {
      totalFisicoNacional: 0,
      enFiscal: 0,
      fiscalBreakdown: [],
    };
    if (esDepositoFiscal(s.deposito.tipo)) {
      agg.enFiscal += s.cantidadFisica;
      agg.fiscalBreakdown.push({ deposito: s.deposito.nombre, cantidad: s.cantidadFisica });
    } else {
      agg.totalFisicoNacional += s.cantidadFisica;
    }
    out.set(s.productoId, agg);
  }
  return out;
}

/** ¿La fecha entra en el corte ETA ≤ hoy+90d? Sin fecha → INCLUIDA (OD-04). */
function dentroDelCorte(fecha: Date | null, corte: Date): boolean {
  return fecha === null || fecha.getTime() <= corte.getTime();
}

/**
 * Futuro Comex por producto: reusa las filas YA agregadas por las queries
 * existentes de la página vieja (`listarEnTransito` / `listarEnProduccion`).
 * Registra los totales SIN corte (semántica de las tabs viejas) y los buckets
 * con corte de 90d sobre las fechas de detalle (llegada / prevista) para la
 * COLUMNA Futuro Comex. "Embarcado" no es separable del modelo → 2 buckets.
 */
function indexarFuturoComex(
  transito: EnTransitoFila[],
  produccion: EnProduccionFila[],
  hoy: Date,
): Map<string, FuturoComexResumen> {
  const corte = new Date(hoy.getTime() + DIAS_CORTE_FUTURO_COMEX * MS_POR_DIA);
  const out = new Map<string, FuturoComexResumen>();
  const entrada = (productoId: string): FuturoComexResumen => {
    const r = out.get(productoId) ?? {
      total: 0,
      enProduccion: 0,
      enTransito: 0,
      enTransitoTotal: 0,
      enProduccionTotal: 0,
    };
    out.set(productoId, r);
    return r;
  };
  for (const fila of transito) {
    for (const d of fila.detalles) {
      const r = entrada(fila.productoId);
      r.enTransitoTotal += d.cantidad;
      if (dentroDelCorte(d.fechaLlegada, corte)) {
        r.enTransito += d.cantidad;
        r.total += d.cantidad;
      }
    }
  }
  for (const fila of produccion) {
    for (const d of fila.detalles) {
      const r = entrada(fila.productoId);
      r.enProduccionTotal += d.cantidad;
      if (dentroDelCorte(d.fechaPrevista, corte)) {
        r.enProduccion += d.cantidad;
        r.total += d.cantidad;
      }
    }
  }
  return out;
}

/** Despachos activos (BORRADOR) por producto — count DISTINCT de despachos. */
function indexarDespachos(
  items: { despachoId: string; itemEmbarque: { productoId: string } }[],
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const it of items) {
    const set = out.get(it.itemEmbarque.productoId) ?? new Set<string>();
    set.add(it.despachoId);
    out.set(it.itemEmbarque.productoId, set);
  }
  return out;
}

/** Días desde el último movimiento (piso 0 — fechas futuras no dan negativo). */
function diasSinMovimiento(ultimoMovimiento: Date, hoy: Date): number {
  return Math.max(0, Math.floor((hoy.getTime() - ultimoMovimiento.getTime()) / MS_POR_DIA));
}

/** Alerta de mayor severidad (OD-04: negativo = alerta máxima). */
function derivarAlerta(f: {
  fisico: number;
  disponible: number;
  bajoMinimo: boolean;
  sinMovimientoDias: number;
}): InventarioAlerta | null {
  if (f.fisico < 0 || f.disponible < 0) return "negativo";
  if (f.bajoMinimo) return "bajo_minimo";
  if (f.sinMovimientoDias >= UMBRAL_ALERTA_SIN_MOVIMIENTO) return "sin_movimiento";
  return null;
}

type ContextoProyeccion = {
  hoy: Date;
  costos: Map<string, string> | null;
  agregados: Map<string, AgregadoProducto>;
  futuro: Map<string, FuturoComexResumen>;
  despachos: Map<string, Set<string>>;
};

const SIN_FUTURO: FuturoComexResumen = {
  total: 0,
  enProduccion: 0,
  enTransito: 0,
  enTransitoTotal: 0,
  enProduccionTotal: 0,
};

/** Defaults de los agregados por producto (sub-helper — CCN del gate). */
function agregadosDeFila(agg: AgregadoProducto | undefined): AgregadoProducto {
  return {
    totalFisicoNacional: agg?.totalFisicoNacional ?? 0,
    enFiscal: agg?.enFiscal ?? 0,
    fiscalBreakdown: agg?.fiscalBreakdown ?? [],
  };
}

/** Enriquecimientos por Maps del contexto (sub-helper — CCN del gate). */
function enriquecimientosDeFila(id: string, productoId: string, ctx: ContextoProyeccion) {
  return {
    costoPromedio: ctx.costos?.get(id) ?? null,
    futuroComex: ctx.futuro.get(productoId) ?? SIN_FUTURO,
    despachosActivos: ctx.despachos.get(productoId)?.size ?? 0,
  };
}

function proyectarFila(s: SpdRow, ctx: ContextoProyeccion): InventarioWorklistRow {
  const id = `${s.productoId}:${s.depositoId}`;
  const agg = agregadosDeFila(ctx.agregados.get(s.productoId));
  const disponible = s.cantidadFisica - s.cantidadReservada;
  const bajoMinimo = s.producto.stockMinimo > 0 && agg.totalFisicoNacional < s.producto.stockMinimo;
  const sinMov = diasSinMovimiento(s.ultimoMovimiento, ctx.hoy);
  return {
    id,
    productoId: s.productoId,
    codigo: s.producto.codigo,
    nombre: s.producto.nombre,
    marca: s.producto.marca,
    medida: s.producto.medida,
    stockMinimo: s.producto.stockMinimo,
    depositoId: s.depositoId,
    depositoNombre: s.deposito.nombre,
    depositoFiscal: esDepositoFiscal(s.deposito.tipo),
    fisico: s.cantidadFisica,
    reservado: s.cantidadReservada,
    disponible,
    ultimoMovimiento: s.ultimoMovimiento.toISOString(),
    sinMovimientoDias: sinMov,
    ...agg,
    ...enriquecimientosDeFila(id, s.productoId, ctx),
    bajoMinimo,
    alerta: derivarAlerta({
      fisico: s.cantidadFisica,
      disponible,
      bajoMinimo,
      sinMovimientoDias: sinMov,
    }),
  };
}

/**
 * Fila "pipeline" sintética: producto SIN posición viva en SPD pero con
 * unidades en tránsito / producción. Sin ella, un SKU zerado con reposición
 * en el agua (o primera importación) desaparecería de la página — las tabs
 * viejas eran product-level y lo mostraban. Cantidades físicas = 0 (no hay
 * stock); el pipeline viaja en `futuroComex`.
 */
function proyectarFilaPipeline(
  p: ProductoMeta & { id: string },
  ctx: ContextoProyeccion,
): InventarioWorklistRow {
  const id = `${p.id}:pipeline`;
  const bajoMinimo = p.stockMinimo > 0;
  return {
    id,
    productoId: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    marca: p.marca,
    medida: p.medida,
    stockMinimo: p.stockMinimo,
    depositoId: "",
    depositoNombre: PIPELINE_DEPOSITO_LABEL,
    depositoFiscal: false,
    fisico: 0,
    reservado: 0,
    disponible: 0,
    ultimoMovimiento: null,
    sinMovimientoDias: 0,
    totalFisicoNacional: 0,
    enFiscal: 0,
    fiscalBreakdown: [],
    ...enriquecimientosDeFila(id, p.id, ctx),
    bajoMinimo,
    alerta: bajoMinimo ? "bajo_minimo" : null,
  };
}

// ── Queries batched ─────────────────────────────────────────────────────────

// Posiciones "vivas": físico o reservado ≠ 0, en depósitos ACTIVOS (la matriz
// vieja sólo renderizaba depósitos activos). Superset deliberado del filtro
// viejo por producto (`cantidadFisica gt 0`): los NEGATIVOS entran para que
// la vista [Negativos] sea honesta (documentado en las notas).
const WHERE_STOCK_VIVO = {
  producto: { activo: true },
  deposito: { activo: true },
  OR: [{ cantidadFisica: { not: 0 } }, { cantidadReservada: { not: 0 } }],
} satisfies Prisma.StockPorDepositoWhereInput;

// Mismo orden en la query base y en la de costos: si el cap se alcanza, los
// dos subconjuntos truncados quedan ALINEADOS (LIMIT sin ORDER BY devuelve
// subconjunto arbitrario en Postgres).
const ORDER_STOCK = [
  { producto: { codigo: "asc" } },
  { deposito: { nombre: "asc" } },
] satisfies Prisma.StockPorDepositoOrderByWithRelationInput[];

function fetchStock(): Promise<SpdRow[]> {
  return db.stockPorDeposito.findMany({
    where: WHERE_STOCK_VIVO,
    orderBy: ORDER_STOCK,
    take: CAP_FILAS,
    // Select estrecho SIN costo: la valorización viaja sólo por `fetchCostos`
    // (query separada, gateada) — sin permiso el número no sale del SQL.
    select: {
      productoId: true,
      depositoId: true,
      cantidadFisica: true,
      cantidadReservada: true,
      ultimoMovimiento: true,
      producto: {
        select: { codigo: true, nombre: true, marca: true, medida: true, stockMinimo: true },
      },
      deposito: { select: { nombre: true, tipo: true } },
    },
  });
}

/** SÓLO se invoca con `VER_COSTO_STOCK` — espejo "query separada" de PR-024. */
async function fetchCostos(): Promise<Map<string, string>> {
  const filas = await db.stockPorDeposito.findMany({
    where: WHERE_STOCK_VIVO,
    orderBy: ORDER_STOCK,
    take: CAP_FILAS,
    select: { productoId: true, depositoId: true, costoPromedio: true },
  });
  return new Map(filas.map((f) => [`${f.productoId}:${f.depositoId}`, f.costoPromedio.toString()]));
}

function fetchDespachosActivos() {
  return db.itemDespacho.findMany({
    where: { despacho: { estado: DespachoEstado.BORRADOR } },
    select: { despachoId: true, itemEmbarque: { select: { productoId: true } } },
  });
}

/** Metadatos de los productos pipeline-only (1 query batched por ids). */
function fetchMetadatosPipeline(ids: string[]) {
  return db.producto.findMany({
    where: { id: { in: ids }, activo: true },
    select: {
      id: true,
      codigo: true,
      nombre: true,
      marca: true,
      medida: true,
      stockMinimo: true,
    },
  });
}

/** Ids con pipeline comex (sin corte) pero SIN fila viva en SPD. */
function idsPipelineSinStock(futuro: Map<string, FuturoComexResumen>, spd: SpdRow[]): string[] {
  const conStock = new Set(spd.map((s) => s.productoId));
  return [...futuro.entries()]
    .filter(([id, f]) => !conStock.has(id) && f.enTransitoTotal + f.enProduccionTotal > 0)
    .map(([id]) => id);
}

function ordenarProductoCentrico(rows: InventarioWorklistRow[]): InventarioWorklistRow[] {
  return rows.sort(
    (a, b) =>
      a.codigo.localeCompare(b.codigo) ||
      a.depositoNombre.localeCompare(b.depositoNombre) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * Proyección principal. `verCosto` llega PRE-resuelto del caller; `hoy` es
 * inyectable sólo para tests deterministas (cortes de fecha).
 */
export async function listarInventarioWorklist(
  verCosto: boolean,
  opts?: { hoy?: Date },
): Promise<{ rows: InventarioWorklistRow[] }> {
  const hoy = opts?.hoy ?? new Date();
  const [spd, costos, transito, produccion, itemsDespacho] = await Promise.all([
    fetchStock(),
    verCosto ? fetchCostos() : Promise.resolve(null),
    listarEnTransito(),
    listarEnProduccion(),
    fetchDespachosActivos(),
  ]);

  const ctx: ContextoProyeccion = {
    hoy,
    costos,
    agregados: agregadosPorProducto(spd),
    futuro: indexarFuturoComex(transito.filas, produccion.filas, hoy),
    despachos: indexarDespachos(itemsDespacho),
  };

  // Filas pipeline sintéticas (producto sin SPD viva pero con comex en curso):
  // 1 query batched extra SÓLO cuando existen faltantes — cero N+1.
  const faltantes = idsPipelineSinStock(ctx.futuro, spd);
  const metadatos = faltantes.length > 0 ? await fetchMetadatosPipeline(faltantes) : [];

  const rows = [
    ...spd.map((s) => proyectarFila(s, ctx)),
    ...metadatos.map((p) => proyectarFilaPipeline(p, ctx)),
  ];
  return { rows: ordenarProductoCentrico(rows) };
}
