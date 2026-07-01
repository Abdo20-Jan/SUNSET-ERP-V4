import "server-only";

import { db } from "@/lib/db";
import { type Decimal, toDecimal } from "@/lib/decimal";
import {
  type MemoriaDespacho,
  type MemoriaDespachoCruzado,
  obtenerMemoriaDespacho,
} from "@/lib/services/despacho-memoria";
import type { CostoLandedResult } from "@/lib/services/despacho-parcial";
import type { ExportColumn } from "@/lib/export/types";
import type { DespachoEstado } from "@/generated/prisma/client";

/*
 * PR-023c (CX-06) — Proyección read-only de la MEMORIA DE CÁLCULO del costo
 * landed (participación por SKU, base usada, badge de función, ajuste de
 * redondeo) + filas/columnas del export auditado.
 *
 * DISPLAY-only: consume el agregado read-only `obtenerMemoriaDespacho` (que
 * envuelve el motor `calcularCostoLandedDespacho` SIN escribir — patrón
 * golden-testeado PR-023-pre, CRIT-05 caso a). NUNCA llama al motor directo,
 * NUNCA recomputa el rateio, NUNCA escribe.
 *
 * Todos los valores MONETARIOS son campos del motor (`landed.*`,
 * `porItem[].*`). La `participación %` y el `ajuste de redondeo` son
 * DERIVACIONES puras de display que reconcilian a los totales del motor
 * (sancionado en IMPLEMENTATION_NOTES_PR023: "participación % é derivável; o
 * ajuste de redondeo… já estão na função"). El costo unitario/total por SKU
 * jamás se recalcula: sale de `porItem[].costoUnitarioLandedArs`/`costoTotalArs`.
 */

export type MemoriaLinea = {
  itemDespachoId: number;
  codigo: string;
  nombre: string;
  cantidad: number;
  /** Participación en la base de rateio (0..100), 2dp — derivada de `base_i / Σ base`. */
  participacionPct: string;
  /** Base usada por el ítem (ARS si FOB; piezas si CANTIDAD), display. */
  base: string;
  /** Capitalizables prorrateados al ítem (ARS, 2dp) — salida del motor. */
  capitalizablesAlocado: string;
  /** Costo landed UNITARIO (ARS, 4dp) — salida del motor. */
  costoUnitarioLanded: string;
  /** Costo total landed del ítem (ARS, 2dp) — salida del motor. */
  costoTotal: string;
};

export type MemoriaDetalleCruzado = {
  tipo: "CRUZADO";
  codigo: string;
  embarqueId: string;
  estado: DespachoEstado;
  baseRateio: "FOB" | "CANTIDAD";
  /** Badge de la función real que usó el motor (derivado de `baseRateio`). */
  funcionBadge: string;
  /** Rótulo de la base usada (evita ambigüedad — §9 estructural 7). */
  baseLabel: string;
  tcEmbarque: string;
  tcDespacho: string;
  /** Valor a ratear = capitalizables totales (ARS, 2dp). */
  valorAtatear: string;
  nacionalizado: string;
  capitalizables: string;
  totalLanded: string;
  /** Ajuste de redondeo absorbido en el último ítem (ARS, 2dp) — anotación. */
  ajusteRedondeo: string;
  lineas: MemoriaLinea[];
};

export type MemoriaDetalleLegacy = {
  tipo: "LEGACY";
  codigo: string;
  estado: DespachoEstado;
};

export type MemoriaDetalle = MemoriaDetalleCruzado | MemoriaDetalleLegacy;

export type MemoriaLeidaResult =
  | { ok: true; detalle: MemoriaDetalle }
  | { ok: false; reason: "SIN_MEMORIA" | "COSTOS_ABIERTOS" };

/** Fila plana del export (todos strings; filas sintéticas Ajuste/Total con celdas vacías). */
export type MemoriaRow = {
  codigo: string;
  producto: string;
  cantidad: string;
  participacion: string;
  base: string;
  capitalizables: string;
  costoUnitario: string;
  costoTotal: string;
};

const FUNCION_BADGE: Record<"FOB" | "CANTIDAD", string> = {
  FOB: "Rateo proporcional por FOB nacionalizado",
  CANTIDAD: "Rateo por cantidad de piezas (FOB total = 0)",
};

const BASE_LABEL: Record<"FOB" | "CANTIDAD", string> = {
  FOB: "Base: FOB nacionalizado (ARS)",
  CANTIDAD: "Base: cantidad de piezas",
};

/** El throw conocido de `obtenerMemoriaDespacho` (costos sin cerrar) vs cualquier
 * otro error (p.ej. embarque faltante = integridad) que DEBE re-lanzarse. */
function esCostosAbiertos(e: unknown): boolean {
  return e instanceof Error && e.message.includes("no tiene costo FC");
}

/** Base de rateio del ítem (FOB nacionalizado del ítem, o cantidad si base FOB = 0). */
function baseDeItem(p: CostoLandedResult["porItem"][number], base: "FOB" | "CANTIDAD"): Decimal {
  return base === "FOB" ? p.costoFcUnitarioArs.times(p.cantidad) : toDecimal(p.cantidad);
}

function mapLinea(
  p: CostoLandedResult["porItem"][number],
  base: Decimal,
  totalBase: Decimal,
  nombres: Map<string, { codigo: string; nombre: string }>,
): MemoriaLinea {
  const n = nombres.get(p.productoId);
  const pct = totalBase.gt(0) ? base.div(totalBase).times(100) : toDecimal(0);
  return {
    itemDespachoId: p.itemDespachoId,
    codigo: n?.codigo ?? p.productoId,
    nombre: n?.nombre ?? "—",
    cantidad: p.cantidad,
    participacionPct: pct.toFixed(2),
    base: base.toFixed(2),
    capitalizablesAlocado: p.capitalizablesItemArs.toFixed(2),
    costoUnitarioLanded: p.costoUnitarioLandedArs.toFixed(4),
    costoTotal: p.costoTotalArs.toFixed(2),
  };
}

/** Ajuste de redondeo = capitalizables totales − Σ round2(participación_i × total).
 * El motor lo absorbe en el último ítem; acá es una ANOTACIÓN (no un total extra:
 * Σ `capitalizablesItemArs` == `capitalizablesArs`, el motor ya reconcilia). */
function calcularAjusteRedondeo(
  landed: CostoLandedResult,
  bases: Decimal[],
  totalBase: Decimal,
): Decimal {
  if (totalBase.lte(0) || landed.porItem.length === 0) return toDecimal(0);
  const total = landed.capitalizablesArs;
  let sumIdeal = toDecimal(0);
  for (const b of bases) {
    sumIdeal = sumIdeal.plus(total.times(b).div(totalBase).toDecimalPlaces(2));
  }
  return total.minus(sumIdeal);
}

/** Proyección PURA de la memoria cruzada (sin I/O). Testeable sin DB. */
export function proyectarMemoria(
  memoria: MemoriaDespachoCruzado,
  nombres: Map<string, { codigo: string; nombre: string }>,
  embarqueId: string,
): MemoriaDetalleCruzado {
  const landed = memoria.landed;
  const bases = landed.porItem.map((p) => baseDeItem(p, memoria.baseRateio));
  const totalBase = bases.reduce((acc, b) => acc.plus(b), toDecimal(0));
  return {
    tipo: "CRUZADO",
    codigo: memoria.codigo,
    embarqueId,
    estado: memoria.estado,
    baseRateio: memoria.baseRateio,
    funcionBadge: FUNCION_BADGE[memoria.baseRateio],
    baseLabel: BASE_LABEL[memoria.baseRateio],
    tcEmbarque: memoria.tipoCambioEmbarque,
    tcDespacho: memoria.tipoCambioDespacho,
    valorAtatear: landed.capitalizablesArs.toFixed(2),
    nacionalizado: landed.nacionalizadoArs.toFixed(2),
    capitalizables: landed.capitalizablesArs.toFixed(2),
    totalLanded: landed.costoTotalArs.toFixed(2),
    ajusteRedondeo: calcularAjusteRedondeo(landed, bases, totalBase).toFixed(2),
    lineas: landed.porItem.map((p, i) => mapLinea(p, bases[i], totalBase, nombres)),
  };
}

/** Nombres (código/descripción) por productoId — read-only, sólo depende de `db`. */
async function nombresPorProducto(
  porItem: CostoLandedResult["porItem"],
): Promise<Map<string, { codigo: string; nombre: string }>> {
  const ids = [...new Set(porItem.map((p) => p.productoId))];
  const productos = await db.producto.findMany({
    where: { id: { in: ids } },
    select: { id: true, codigo: true, nombre: true },
  });
  return new Map(productos.map((p) => [p.id, { codigo: p.codigo, nombre: p.nombre }]));
}

/**
 * Lee la memoria y la proyecta (SIN el gate de permiso — el caller-action gatea
 * `VER_COSTO_LANDED` ANTES de invocar esto). Read-only puro: sólo consume
 * `obtenerMemoriaDespacho` (que no escribe) + un lookup de nombres.
 */
export async function leerMemoriaDetalle(despachoId: string): Promise<MemoriaLeidaResult> {
  let memoria: MemoriaDespacho | null;
  try {
    memoria = await obtenerMemoriaDespacho(despachoId);
  } catch (e) {
    if (esCostosAbiertos(e)) return { ok: false, reason: "COSTOS_ABIERTOS" };
    throw e; // error de integridad (p.ej. embarque faltante): NO enmascarar
  }
  if (!memoria) return { ok: false, reason: "SIN_MEMORIA" };
  if (memoria.tipo === "LEGACY") {
    return {
      ok: true,
      detalle: { tipo: "LEGACY", codigo: memoria.codigo, estado: memoria.estado },
    };
  }
  const [nombres, cab] = await Promise.all([
    nombresPorProducto(memoria.landed.porItem),
    db.despacho.findUnique({ where: { id: despachoId }, select: { embarqueId: true } }),
  ]);
  return { ok: true, detalle: proyectarMemoria(memoria, nombres, cab?.embarqueId ?? "") };
}

/** Columnas del export (agnósticas al formato). Sólo campos de la memoria —
 * jamás ledger crudo (sin `debe`/líneas de asiento). */
export function memoriaExportColumns(): ExportColumn<MemoriaRow>[] {
  return [
    { header: "Código", value: (r) => r.codigo },
    { header: "Producto", value: (r) => r.producto },
    { header: "Cantidad", value: (r) => r.cantidad },
    { header: "Participación %", value: (r) => r.participacion },
    { header: "Base (ARS/piezas)", value: (r) => r.base },
    { header: "Capitalizables alocados (ARS)", value: (r) => r.capitalizables },
    { header: "Costo unit. landed (ARS)", value: (r) => r.costoUnitario },
    { header: "Costo total landed (ARS)", value: (r) => r.costoTotal },
  ];
}

/** Filas del export: una por SKU + fila "Ajuste de redondeo" + fila "TOTAL"
 * (100% / capitalizables / total landed). Auto-contenido y auditable. */
export function buildMemoriaRows(detalle: MemoriaDetalleCruzado): MemoriaRow[] {
  const filas: MemoriaRow[] = detalle.lineas.map((l) => ({
    codigo: l.codigo,
    producto: l.nombre,
    cantidad: String(l.cantidad),
    participacion: l.participacionPct,
    base: l.base,
    capitalizables: l.capitalizablesAlocado,
    costoUnitario: l.costoUnitarioLanded,
    costoTotal: l.costoTotal,
  }));
  const ajuste: MemoriaRow = {
    codigo: "—",
    producto: "Ajuste de redondeo (absorbido en el último ítem)",
    cantidad: "",
    participacion: "",
    base: "",
    capitalizables: detalle.ajusteRedondeo,
    costoUnitario: "",
    costoTotal: "",
  };
  const total: MemoriaRow = {
    codigo: "—",
    producto: "TOTAL",
    cantidad: "",
    participacion: "100.00",
    base: detalle.nacionalizado,
    capitalizables: detalle.capitalizables,
    costoUnitario: "",
    costoTotal: detalle.totalLanded,
  };
  return [...filas, ajuste, total];
}
