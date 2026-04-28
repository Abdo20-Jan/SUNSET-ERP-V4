import "server-only";

import Decimal from "decimal.js";

import { money, toDecimal } from "@/lib/decimal";
import { AsientoError } from "@/lib/services/asiento-automatico";
import {
  MovimientoStockTipo,
  Prisma,
} from "@/generated/prisma/client";

type TxClient = Prisma.TransactionClient;

type IngresoItem = {
  itemEmbarqueId: number;
  productoId: string;
  cantidad: number;
  costoUnitario: Decimal;
};

export async function aplicarIngresoEmbarque(
  tx: TxClient,
  params: {
    depositoDestinoId: string;
    fecha: Date;
    items: readonly IngresoItem[];
  },
): Promise<void> {
  const deposito = await tx.deposito.findUnique({
    where: { id: params.depositoDestinoId },
    select: { id: true, activo: true },
  });
  if (!deposito) {
    throw new AsientoError(
      "DOMINIO_INVALIDO",
      "El depósito de destino del embarque no existe.",
    );
  }
  if (!deposito.activo) {
    throw new AsientoError(
      "DOMINIO_INVALIDO",
      "El depósito de destino está inactivo.",
    );
  }

  for (const item of params.items) {
    await tx.itemEmbarque.update({
      where: { id: item.itemEmbarqueId },
      data: { costoUnitario: money(item.costoUnitario) },
    });

    await tx.movimientoStock.create({
      data: {
        productoId: item.productoId,
        depositoId: params.depositoDestinoId,
        tipo: MovimientoStockTipo.INGRESO,
        cantidad: item.cantidad,
        costoUnitario: money(item.costoUnitario),
        fecha: params.fecha,
        itemEmbarqueId: item.itemEmbarqueId,
      },
    });

    await aplicarIngresoProducto(
      tx,
      item.productoId,
      item.cantidad,
      item.costoUnitario,
    );
  }
}

async function aplicarIngresoProducto(
  tx: TxClient,
  productoId: string,
  cantidadIngreso: number,
  costoUnitarioIngreso: Decimal,
): Promise<void> {
  const producto = await tx.producto.findUnique({
    where: { id: productoId },
    select: { stockActual: true, costoPromedio: true },
  });
  if (!producto) {
    throw new AsientoError(
      "DOMINIO_INVALIDO",
      `El producto ${productoId} no existe.`,
    );
  }

  const stockActual = producto.stockActual;
  const costoPromedioActual = toDecimal(producto.costoPromedio);
  const nuevoStock = stockActual + cantidadIngreso;

  let nuevoCostoPromedio: Decimal;
  if (stockActual <= 0 || nuevoStock <= 0) {
    nuevoCostoPromedio = costoUnitarioIngreso;
  } else {
    const valorAnterior = costoPromedioActual.times(stockActual);
    const valorIngreso = costoUnitarioIngreso.times(cantidadIngreso);
    nuevoCostoPromedio = valorAnterior
      .plus(valorIngreso)
      .dividedBy(nuevoStock);
  }

  await tx.producto.update({
    where: { id: productoId },
    data: {
      stockActual: nuevoStock,
      costoPromedio: money(nuevoCostoPromedio),
    },
  });
}

type IngresoDespachoItem = {
  itemDespachoId: number;
  productoId: string;
  cantidad: number;
  costoUnitario: Decimal;
};

/**
 * Aplica el ingreso de stock generado por contabilizar un Despacho
 * parcial. Idéntico a `aplicarIngresoEmbarque` pero linkando los
 * `MovimientoStock` al `itemDespachoId` (no a `itemEmbarqueId`) para
 * permitir reversión limpia al anular el despacho.
 */
export async function aplicarIngresoDespacho(
  tx: TxClient,
  params: {
    depositoDestinoId: string;
    fecha: Date;
    items: readonly IngresoDespachoItem[];
  },
): Promise<void> {
  const deposito = await tx.deposito.findUnique({
    where: { id: params.depositoDestinoId },
    select: { id: true, activo: true },
  });
  if (!deposito) {
    throw new AsientoError(
      "DOMINIO_INVALIDO",
      "El depósito de destino del despacho no existe.",
    );
  }
  if (!deposito.activo) {
    throw new AsientoError(
      "DOMINIO_INVALIDO",
      "El depósito de destino está inactivo.",
    );
  }

  for (const item of params.items) {
    await tx.itemDespacho.update({
      where: { id: item.itemDespachoId },
      data: { costoUnitario: money(item.costoUnitario) },
    });

    await tx.movimientoStock.create({
      data: {
        productoId: item.productoId,
        depositoId: params.depositoDestinoId,
        tipo: MovimientoStockTipo.INGRESO,
        cantidad: item.cantidad,
        costoUnitario: money(item.costoUnitario),
        fecha: params.fecha,
        itemDespachoId: item.itemDespachoId,
      },
    });

    await aplicarIngresoProducto(
      tx,
      item.productoId,
      item.cantidad,
      item.costoUnitario,
    );
  }
}

/**
 * Revierte los ingresos de stock generados al contabilizar un despacho
 * parcial. Borra los `MovimientoStock` ligados a sus `ItemDespacho`,
 * resetea `ItemDespacho.costoUnitario` y replays el resto de movimientos
 * para reconstruir `Producto.stockActual` + `costoPromedio`.
 */
export async function revertirIngresoDespacho(
  tx: TxClient,
  despachoId: string,
): Promise<void> {
  const items = await tx.itemDespacho.findMany({
    where: { despachoId },
    select: { id: true, itemEmbarque: { select: { productoId: true } } },
  });
  if (items.length === 0) return;

  const itemIds = items.map((i) => i.id);
  const productoIds = Array.from(
    new Set(items.map((i) => i.itemEmbarque.productoId)),
  );

  await tx.movimientoStock.deleteMany({
    where: { itemDespachoId: { in: itemIds } },
  });

  await tx.itemDespacho.updateMany({
    where: { id: { in: itemIds } },
    data: { costoUnitario: money(new Decimal(0)) },
  });

  for (const productoId of productoIds) {
    await recalcularStockYCostoPromedio(tx, productoId);
  }
}

/**
 * Revierte los ingresos de stock generados al cerrar un embarque.
 * Borra los `MovimientoStock` ligados a sus `ItemEmbarque` y recalcula
 * `Producto.stockActual` + `Producto.costoPromedio` desde cero usando
 * el resto de los movimientos de stock (replay del weighted average).
 *
 * Reset también `ItemEmbarque.costoUnitario` a 0 para que un re-cierre
 * recompute todo limpio.
 */
export async function revertirIngresoEmbarque(
  tx: TxClient,
  embarqueId: string,
): Promise<void> {
  const items = await tx.itemEmbarque.findMany({
    where: { embarqueId },
    select: { id: true, productoId: true },
  });
  if (items.length === 0) return;

  const itemIds = items.map((i) => i.id);
  const productoIds = Array.from(new Set(items.map((i) => i.productoId)));

  await tx.movimientoStock.deleteMany({
    where: { itemEmbarqueId: { in: itemIds } },
  });

  await tx.itemEmbarque.updateMany({
    where: { id: { in: itemIds } },
    data: { costoUnitario: money(new Decimal(0)) },
  });

  for (const productoId of productoIds) {
    await recalcularStockYCostoPromedio(tx, productoId);
  }
}

/**
 * Replays todos los `MovimientoStock` del producto en orden cronológico
 * para reconstruir `stockActual` y `costoPromedio` desde cero. Usa la
 * misma fórmula de promedio ponderado que `aplicarIngresoProducto`.
 *
 * INGRESO suma cantidad y promedia costo. EGRESO/AJUSTE/TRANSFERENCIA
 * sólo afectan stock; el costo medio se mantiene (FIFO/AVCO clásico).
 */
export async function recalcularStockYCostoPromedio(
  tx: TxClient,
  productoId: string,
): Promise<void> {
  const movimientos = await tx.movimientoStock.findMany({
    where: { productoId },
    orderBy: [{ fecha: "asc" }, { id: "asc" }],
    select: { tipo: true, cantidad: true, costoUnitario: true },
  });

  let stock = 0;
  let promedio = new Decimal(0);

  for (const m of movimientos) {
    if (m.tipo === MovimientoStockTipo.INGRESO) {
      const costoIngreso = toDecimal(m.costoUnitario);
      const nuevoStock = stock + m.cantidad;
      if (stock <= 0 || nuevoStock <= 0) {
        promedio = costoIngreso;
      } else {
        const valorAnterior = promedio.times(stock);
        const valorIngreso = costoIngreso.times(m.cantidad);
        promedio = valorAnterior.plus(valorIngreso).dividedBy(nuevoStock);
      }
      stock = nuevoStock;
    } else if (m.tipo === MovimientoStockTipo.EGRESO) {
      stock -= m.cantidad;
    } else if (m.tipo === MovimientoStockTipo.AJUSTE) {
      // AJUSTE: cantidad signada (positiva o negativa según convención
      // del registro). Mantiene costo medio.
      stock += m.cantidad;
    } else if (m.tipo === MovimientoStockTipo.TRANSFERENCIA) {
      // Transferencia entre depósitos: no afecta stock total ni costo.
    }
  }

  await tx.producto.update({
    where: { id: productoId },
    data: {
      stockActual: stock,
      costoPromedio: money(promedio),
    },
  });
}
