import "server-only";

import { db } from "@/lib/db";

// Drill-down asiento → documento de origen (F0-FND-7).
//
// El `model Asiento` tiene 15 relaciones 1:1 opcionales hacia su documento de
// origen (venta, compra, embarque, despacho, pago, gasto, anticipo, …). Cada
// asiento tiene a lo sumo UNA poblada — o ninguna (cierre / destino de
// resultado / ajuste manual). Este resolvedor traduce un `asientoId` al
// documento navegable `{ tipo, id, href, etiqueta }`, resolviendo en LOTE para
// evitar N+1 desde el libro mayor (cuyas líneas sólo exponen `asientoId`).
//
// Las rutas las fija el helper SÍNCRONO PURO `resolverDocumentoOrigen` (sin
// Prisma, testeable aislado). La parte async sólo consulta las claves
// estructurales mínimas y delega.

/** Universo de tipos de documento de origen (1:1 con las relaciones del asiento). */
export type DocumentoOrigenTipo =
  | "venta"
  | "compra"
  | "embarque"
  | "despacho"
  | "embarque-costo"
  | "pago"
  | "gasto"
  | "gasto-fijo"
  | "prestamo"
  | "cheque-cobro"
  | "entrega"
  | "anticipo"
  | "aplicacion-anticipo"
  | "divergencia";

export type DocumentoOrigen = {
  tipo: DocumentoOrigenTipo;
  /** Id del documento de origen (no del asiento). */
  id: string;
  /** Ruta de detalle navegable (confirmada contra el FS de rutas). */
  href: string;
  /** Rótulo corto para el link (ej. "Venta", "Pago"). */
  etiqueta: string;
};

/**
 * Claves estructurales (ids de las relaciones 1:1) de un asiento, ya
 * normalizadas a string. Despacho y costo de embarque NO tienen ruta `[id]`
 * propia → se navega al embarque-padre, por eso se aportan ambos ids.
 */
export type ClavesOrigenAsiento = {
  ventaId?: string;
  compraId?: string;
  /** Embarque por cierre o por zona primaria (misma ruta de detalle). */
  embarqueId?: string;
  despachoId?: string;
  despachoEmbarqueId?: string;
  embarqueCostoId?: string;
  embarqueCostoEmbarqueId?: string;
  movimientoId?: string;
  gastoId?: string;
  gastoFijoRegistroId?: string;
  prestamoId?: string;
  chequeRecibidoCobroId?: string;
  entregaVentaId?: string;
  anticipoProveedorId?: string;
  aplicacionAnticipoId?: string;
  divergenciaAjusteId?: string;
};

/**
 * Helper SÍNCRONO PURO: dada las claves estructurales de un asiento, resuelve
 * el documento de origen en orden de prioridad determinístico. Centraliza las
 * rutas exactas (confirmadas contra `src/app/(dashboard)/...`). Devuelve `null`
 * cuando ninguna relación está poblada o no existe ruta de destino.
 *
 * Rutas SIN `[id]` propio (resuelven al índice/padre):
 *  - despacho / costo de embarque → `/comex/embarques/{embarqueId}` (padre).
 *  - anticipo / aplicación de anticipo → `/tesoreria/anticipos` (índice + sheet).
 *  - préstamo → `/tesoreria/prestamos`, gasto fijo → `/gastos-fijos`,
 *    entrega → `/entregas` (índices; no hay detalle `[id]`).
 *
 * Relaciones SIN ruta hoy (resuelven `null`, reservadas en la unión por
 * completitud del dominio): `chequeRecibidoCobro` y `divergenciaAjuste` no
 * tienen pantalla de detalle propia.
 */
export function resolverDocumentoOrigen(claves: ClavesOrigenAsiento): DocumentoOrigen | null {
  if (claves.ventaId) {
    return {
      tipo: "venta",
      id: claves.ventaId,
      href: `/ventas/${claves.ventaId}`,
      etiqueta: "Venta",
    };
  }
  if (claves.compraId) {
    return {
      tipo: "compra",
      id: claves.compraId,
      href: `/compras/${claves.compraId}`,
      etiqueta: "Compra",
    };
  }
  if (claves.embarqueId) {
    return {
      tipo: "embarque",
      id: claves.embarqueId,
      href: `/comex/embarques/${claves.embarqueId}`,
      etiqueta: "Embarque",
    };
  }
  // Despacho: NO existe `/comex/despachos/[id]` → href del embarque-padre.
  if (claves.despachoId && claves.despachoEmbarqueId) {
    return {
      tipo: "despacho",
      id: claves.despachoId,
      href: `/comex/embarques/${claves.despachoEmbarqueId}`,
      etiqueta: "Despacho",
    };
  }
  // Costo de embarque: idem despacho, navega al embarque-padre.
  if (claves.embarqueCostoId && claves.embarqueCostoEmbarqueId) {
    return {
      tipo: "embarque-costo",
      id: claves.embarqueCostoId,
      href: `/comex/embarques/${claves.embarqueCostoEmbarqueId}`,
      etiqueta: "Costo embarque",
    };
  }
  if (claves.movimientoId) {
    return {
      tipo: "pago",
      id: claves.movimientoId,
      href: `/tesoreria/movimientos/${claves.movimientoId}`,
      etiqueta: "Pago",
    };
  }
  if (claves.gastoId) {
    return {
      tipo: "gasto",
      id: claves.gastoId,
      href: `/gastos/${claves.gastoId}`,
      etiqueta: "Gasto",
    };
  }
  if (claves.gastoFijoRegistroId) {
    return {
      tipo: "gasto-fijo",
      id: claves.gastoFijoRegistroId,
      href: "/gastos-fijos",
      etiqueta: "Gasto fijo",
    };
  }
  if (claves.prestamoId) {
    return {
      tipo: "prestamo",
      id: claves.prestamoId,
      href: "/tesoreria/prestamos",
      etiqueta: "Préstamo",
    };
  }
  if (claves.entregaVentaId) {
    return { tipo: "entrega", id: claves.entregaVentaId, href: "/entregas", etiqueta: "Entrega" };
  }
  if (claves.anticipoProveedorId) {
    return {
      tipo: "anticipo",
      id: claves.anticipoProveedorId,
      href: "/tesoreria/anticipos",
      etiqueta: "Anticipo",
    };
  }
  if (claves.aplicacionAnticipoId) {
    return {
      tipo: "aplicacion-anticipo",
      id: claves.aplicacionAnticipoId,
      href: "/tesoreria/anticipos",
      etiqueta: "Aplic. anticipo",
    };
  }
  // chequeRecibidoCobro / divergenciaAjuste: sin ruta de detalle → null.
  return null;
}

function idStr(v: string | number | null | undefined): string | undefined {
  return v == null ? undefined : String(v);
}

/**
 * Resuelve, en una ÚNICA consulta, el documento de origen de cada asiento.
 * Devuelve un `Map` con UNA entrada por id distinto de entrada (incluidos los
 * que resuelven `null` — sin documento — y los ids inexistentes).
 *
 * `select` mínimo: sólo `id` de cada relación (+ `embarqueId` de despacho y
 * costo de embarque). Nunca `include` cheio — la query debe ser barata.
 */
export async function documentosOrigenPorAsiento(
  asientoIds: string[],
): Promise<Map<string, DocumentoOrigen | null>> {
  const distintos = [...new Set(asientoIds)];
  const resultado = new Map<string, DocumentoOrigen | null>();
  if (distintos.length === 0) return resultado;

  const asientos = await db.asiento.findMany({
    where: { id: { in: distintos } },
    select: {
      id: true,
      venta: { select: { id: true } },
      compra: { select: { id: true } },
      embarqueCierre: { select: { id: true } },
      embarqueZonaPrimaria: { select: { id: true } },
      despacho: { select: { id: true, embarqueId: true } },
      embarqueCosto: { select: { id: true, embarqueId: true } },
      movimiento: { select: { id: true } },
      gasto: { select: { id: true } },
      gastoFijoRegistro: { select: { id: true } },
      prestamo: { select: { id: true } },
      chequeRecibidoCobro: { select: { id: true } },
      entregaVenta: { select: { id: true } },
      anticipoProveedor: { select: { id: true } },
      aplicacionAnticipo: { select: { id: true } },
      divergenciaAjuste: { select: { id: true } },
    },
  });

  for (const a of asientos) {
    resultado.set(
      a.id,
      resolverDocumentoOrigen({
        ventaId: idStr(a.venta?.id),
        compraId: idStr(a.compra?.id),
        embarqueId: idStr(a.embarqueCierre?.id ?? a.embarqueZonaPrimaria?.id),
        despachoId: idStr(a.despacho?.id),
        despachoEmbarqueId: idStr(a.despacho?.embarqueId),
        embarqueCostoId: idStr(a.embarqueCosto?.id),
        embarqueCostoEmbarqueId: idStr(a.embarqueCosto?.embarqueId),
        movimientoId: idStr(a.movimiento?.id),
        gastoId: idStr(a.gasto?.id),
        gastoFijoRegistroId: idStr(a.gastoFijoRegistro?.id),
        prestamoId: idStr(a.prestamo?.id),
        chequeRecibidoCobroId: idStr(a.chequeRecibidoCobro?.id),
        entregaVentaId: idStr(a.entregaVenta?.id),
        anticipoProveedorId: idStr(a.anticipoProveedor?.id),
        aplicacionAnticipoId: idStr(a.aplicacionAnticipo?.id),
        divergenciaAjusteId: idStr(a.divergenciaAjuste?.id),
      }),
    );
  }

  // Garantizar una entrada por id de entrada, incluidos los inexistentes.
  for (const id of distintos) {
    if (!resultado.has(id)) resultado.set(id, null);
  }

  return resultado;
}

/** Conveniencia unitaria sobre el batch. */
export async function documentoOrigen(asientoId: string): Promise<DocumentoOrigen | null> {
  const map = await documentosOrigenPorAsiento([asientoId]);
  return map.get(asientoId) ?? null;
}
