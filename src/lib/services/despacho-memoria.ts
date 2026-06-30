import "server-only";

import { db } from "@/lib/db";
import {
  calcularCostoLandedDespacho,
  type CostoLandedResult,
} from "@/lib/services/despacho-parcial";
import type { DespachoEstado } from "@/generated/prisma/client";

// ============================================================
// PR-023 (CX-06) — Memoria de cálculo del costo landed (READ-ONLY)
// ============================================================
//
// DO-NOT-TOUCH (CRIT-04/05): este módulo NO recalcula ni reimplementa el motor
// de rateio. Sólo RELEE un despacho persistido y reproduce —sin escribir— la
// memoria de cálculo invocando la MISMA función real `calcularCostoLandedDespacho`
// con el MISMO ensamblado de input que `contabilizarDespachoAction` (fork
// cruzado, `despachos.ts:506-573`).
//
// El costo landed (rateio FOB de DIE/Tasa/Arancel + facturas DESPACHO) sólo
// aplica al despacho CRUZADO. En el fork legacy (sin itemContenedor) el costo se
// preserva por línea (ItemEmbarque.costoUnitario) y no hay memoria de rateio →
// `tipo === "LEGACY"`.
//
// El filtro de facturas DESPACHO (`momento != ZONA_PRIMARIA`, estado
// BORRADOR|LEGACY_BUNDLED) es idéntico al del action y al de
// `crearAsientoDespachoCruzado`: al contabilizar, las facturas BORRADOR pasan a
// LEGACY_BUNDLED, por lo que la memoria es byte-estable ANTES (BORRADOR, para
// "Simular") y DESPUÉS (CONTABILIZADO) de contabilizar.

export interface MemoriaDespachoCruzado {
  tipo: "CRUZADO";
  despachoId: string;
  codigo: string;
  estado: DespachoEstado;
  /** TC del embarque (FC → ARS). */
  tipoCambioEmbarque: string;
  /** TC del despacho (tributos → ARS). */
  tipoCambioDespacho: string;
  /** Base de prorrateo que usó el motor: FOB, o CANTIDAD si la base FOB es 0. */
  baseRateio: "FOB" | "CANTIDAD";
  /** Salida cruda del motor (`calcularCostoLandedDespacho`). */
  landed: CostoLandedResult;
}

export interface MemoriaDespachoLegacy {
  tipo: "LEGACY";
  despachoId: string;
  codigo: string;
  estado: DespachoEstado;
}

export type MemoriaDespacho = MemoriaDespachoCruzado | MemoriaDespachoLegacy;

export async function obtenerMemoriaDespacho(despachoId: string): Promise<MemoriaDespacho | null> {
  if (!despachoId || typeof despachoId !== "string") return null;

  const cab = await db.despacho.findUnique({
    where: { id: despachoId },
    select: {
      codigo: true,
      estado: true,
      embarqueId: true,
      tipoCambio: true,
      die: true,
      tasaEstadistica: true,
      arancelSim: true,
      items: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          cantidad: true,
          itemContenedor: {
            select: { productoId: true, costoFCUnitario: true },
          },
        },
      },
      // Facturas DESPACHO linkadas — MISMO filtro que contabilizarDespachoAction
      // y crearAsientoDespachoCruzado (BORRADOR/LEGACY_BUNDLED, momento != ZP).
      costos: {
        where: {
          momento: { not: "ZONA_PRIMARIA" },
          estado: { in: ["BORRADOR", "LEGACY_BUNDLED"] },
        },
        select: {
          tipoCambio: true,
          lineas: { select: { subtotal: true }, orderBy: { id: "asc" } },
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!cab) return null;

  // Fork por contenido (igual que el action): si alguna línea referencia un
  // ItemContenedor, es CRUZADO. Si ninguna, es legacy → sin memoria de rateio.
  const esCruzado = cab.items.some((i) => i.itemContenedor != null);
  if (!esCruzado) {
    return { tipo: "LEGACY", despachoId, codigo: cab.codigo, estado: cab.estado };
  }

  const embarque = await db.embarque.findUniqueOrThrow({
    where: { id: cab.embarqueId },
    select: { tipoCambio: true },
  });

  const landed = calcularCostoLandedDespacho({
    tipoCambioEmbarque: embarque.tipoCambio,
    tipoCambioDespacho: cab.tipoCambio,
    die: cab.die,
    tasaEstadistica: cab.tasaEstadistica,
    arancelSim: cab.arancelSim,
    facturasDespacho: cab.costos.flatMap((f) =>
      f.lineas.map((l) => ({ subtotal: l.subtotal, tipoCambio: f.tipoCambio })),
    ),
    items: cab.items.map((i) => {
      const ic = i.itemContenedor;
      if (ic?.costoFCUnitario == null) {
        // Espelha la guarda del action: sin costo FC no hay memoria posible.
        throw new Error(
          `Despacho ${cab.codigo}: una línea cruzada no tiene costo FC (cerrá costos antes de ver la memoria).`,
        );
      }
      return {
        itemDespachoId: i.id,
        productoId: ic.productoId,
        cantidad: i.cantidad,
        costoFCUnitario: ic.costoFCUnitario,
      };
    }),
  });

  // Etiqueta de base (hint de display, NO recálculo del rateio): el motor usa
  // prorrateo por CANTIDAD sólo cuando la base FOB total es 0 (muestras).
  const baseRateio: "FOB" | "CANTIDAD" = landed.nacionalizadoArs.gt(0) ? "FOB" : "CANTIDAD";

  return {
    tipo: "CRUZADO",
    despachoId,
    codigo: cab.codigo,
    estado: cab.estado,
    tipoCambioEmbarque: embarque.tipoCambio.toString(),
    tipoCambioDespacho: cab.tipoCambio.toString(),
    baseRateio,
    landed,
  };
}
