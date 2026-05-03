import "server-only";

import Decimal from "decimal.js";

import { MovimientoStockTipo, type Prisma } from "@/generated/prisma/client";
import { money, toDecimal } from "@/lib/decimal";
import { AsientoError } from "@/lib/services/asiento-automatico";

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
    await aplicarIngresoSPD(
      tx,
      item.productoId,
      params.depositoDestinoId,
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
    await aplicarIngresoSPD(
      tx,
      item.productoId,
      params.depositoDestinoId,
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
    await recalcularSPDPorProducto(tx, productoId);
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
    await recalcularSPDPorProducto(tx, productoId);
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

// ===============================================================
// W3 — Stock por depósito (StockPorDeposito)
// ===============================================================
//
// Las funciones de abajo operan sobre `StockPorDeposito` — la fuente
// de verdad multi-depósito introducida en W3. Conviven con las
// funciones legacy (que mantienen `Producto.stockActual` global) hasta
// que `Producto.stockActual` sea derivable de SUM(SPD.cantidadFisica).

/**
 * Aplica un ingreso de stock al `StockPorDeposito` correspondiente al
 * par (productoId, depositoId). Crea el row si no existe; si existe,
 * suma la cantidad y recalcula el costo promedio ponderado del
 * depósito (decisión arquitectónica W3 #3 — costoPromedio por depósito).
 */
export async function aplicarIngresoSPD(
  tx: TxClient,
  productoId: string,
  depositoId: string,
  cantidadIngreso: number,
  costoUnitarioIngreso: Decimal,
): Promise<void> {
  const existing = await tx.stockPorDeposito.findUnique({
    where: { productoId_depositoId: { productoId, depositoId } },
    select: { cantidadFisica: true, costoPromedio: true },
  });
  if (!existing) {
    await tx.stockPorDeposito.create({
      data: {
        productoId,
        depositoId,
        cantidadFisica: cantidadIngreso,
        cantidadReservada: 0,
        costoPromedio: money(costoUnitarioIngreso),
        ultimoMovimiento: new Date(),
      },
    });
    return;
  }
  const stockActual = existing.cantidadFisica;
  const promedioActual = toDecimal(existing.costoPromedio);
  const nuevoStock = stockActual + cantidadIngreso;
  let nuevoPromedio: Decimal;
  if (stockActual <= 0 || nuevoStock <= 0) {
    nuevoPromedio = costoUnitarioIngreso;
  } else {
    const valorAnterior = promedioActual.times(stockActual);
    const valorIngreso = costoUnitarioIngreso.times(cantidadIngreso);
    nuevoPromedio = valorAnterior.plus(valorIngreso).dividedBy(nuevoStock);
  }
  await tx.stockPorDeposito.update({
    where: { productoId_depositoId: { productoId, depositoId } },
    data: {
      cantidadFisica: nuevoStock,
      costoPromedio: money(nuevoPromedio),
      ultimoMovimiento: new Date(),
    },
  });
}

/**
 * Aplica un egreso físico al SPD: decrementa cantidadFisica y
 * cantidadReservada por la cantidad dada. Usado al confirmar una
 * entrega (remito) — la mercadería sale del depósito y se libera la
 * reserva equivalente. NO valida disponibilidad — el caller debe
 * haber validado antes (vía `validarDisponible`).
 */
export async function aplicarEgresoSPD(
  tx: TxClient,
  productoId: string,
  depositoId: string,
  cantidad: number,
): Promise<void> {
  await tx.stockPorDeposito.update({
    where: { productoId_depositoId: { productoId, depositoId } },
    data: {
      cantidadFisica: { decrement: cantidad },
      cantidadReservada: { decrement: cantidad },
      ultimoMovimiento: new Date(),
    },
  });
}

/**
 * Aplica una reserva al SPD: incrementa cantidadReservada por la
 * cantidad dada. Usado al emitir una venta — la mercadería todavía
 * está físicamente en el depósito pero queda comprometida hasta la
 * entrega. NO valida disponibilidad — el caller debe haber validado
 * antes (vía `validarDisponible`).
 */
export async function aplicarReservaSPD(
  tx: TxClient,
  productoId: string,
  depositoId: string,
  cantidad: number,
): Promise<void> {
  await tx.stockPorDeposito.update({
    where: { productoId_depositoId: { productoId, depositoId } },
    data: {
      cantidadReservada: { increment: cantidad },
      ultimoMovimiento: new Date(),
    },
  });
}

/**
 * Libera una reserva al SPD: decrementa cantidadReservada. Usado al
 * anular una venta antes de entregar — devuelve disponibilidad sin
 * tocar la cantidad física.
 */
export async function liberarReservaSPD(
  tx: TxClient,
  productoId: string,
  depositoId: string,
  cantidad: number,
): Promise<void> {
  await tx.stockPorDeposito.update({
    where: { productoId_depositoId: { productoId, depositoId } },
    data: {
      cantidadReservada: { decrement: cantidad },
      ultimoMovimiento: new Date(),
    },
  });
}

/**
 * Aplica una transferencia: decrementa cantidadFisica del depósito
 * origen e incrementa la del destino (creando el row destino si no
 * existe, manteniendo el costoPromedio del origen). Genera 2
 * MovimientoStock tipo TRANSFERENCIA — uno por dirección — linkados
 * a la misma `Transferencia`. NO valida disponibilidad ni que origen
 * != destino — caller debe validar antes.
 */
export async function aplicarTransferenciaSPD(
  tx: TxClient,
  params: {
    productoId: string;
    depositoOrigenId: string;
    depositoDestinoId: string;
    cantidad: number;
    fecha: Date;
    transferenciaId: string;
  },
): Promise<void> {
  const origen = await tx.stockPorDeposito.findUnique({
    where: {
      productoId_depositoId: {
        productoId: params.productoId,
        depositoId: params.depositoOrigenId,
      },
    },
    select: { costoPromedio: true },
  });
  if (!origen) {
    throw new AsientoError(
      "DOMINIO_INVALIDO",
      `No hay stock del producto ${params.productoId} en el depósito origen ${params.depositoOrigenId}.`,
    );
  }
  const costoUnitario = toDecimal(origen.costoPromedio);

  // Decrementar origen
  await tx.stockPorDeposito.update({
    where: {
      productoId_depositoId: {
        productoId: params.productoId,
        depositoId: params.depositoOrigenId,
      },
    },
    data: {
      cantidadFisica: { decrement: params.cantidad },
      ultimoMovimiento: params.fecha,
    },
  });

  // Incrementar destino — usa aplicarIngresoSPD para promedio ponderado
  // si ya existe stock previo en destino.
  await aplicarIngresoSPD(
    tx,
    params.productoId,
    params.depositoDestinoId,
    params.cantidad,
    costoUnitario,
  );

  // 2 MovimientoStock tipo TRANSFERENCIA, linkados a la misma transferencia
  await tx.movimientoStock.createMany({
    data: [
      {
        productoId: params.productoId,
        depositoId: params.depositoOrigenId,
        tipo: MovimientoStockTipo.TRANSFERENCIA,
        cantidad: -params.cantidad,
        costoUnitario: money(costoUnitario),
        fecha: params.fecha,
        transferenciaId: params.transferenciaId,
      },
      {
        productoId: params.productoId,
        depositoId: params.depositoDestinoId,
        tipo: MovimientoStockTipo.TRANSFERENCIA,
        cantidad: params.cantidad,
        costoUnitario: money(costoUnitario),
        fecha: params.fecha,
        transferenciaId: params.transferenciaId,
      },
    ],
  });
}

/**
 * Recalcula `StockPorDeposito` para un producto desde cero, replayando
 * todos sus `MovimientoStock` agrupados por depósito. Usado en la
 * reversión de embarque/despacho para mantener consistencia.
 *
 * Convenciones de cantidad por tipo:
 *  - INGRESO: cantidad positiva, suma a cantidadFisica del depósito
 *    del movimiento + recalcula promedio ponderado.
 *  - EGRESO: cantidad positiva, resta a cantidadFisica del depósito
 *    del movimiento. Mantiene promedio.
 *  - AJUSTE: cantidad signed, suma directamente. Mantiene promedio.
 *  - TRANSFERENCIA: cantidad signed (negativa en origen, positiva en
 *    destino). Suma directamente al SPD del depósito del movimiento.
 *    Mantiene promedio.
 *
 * Nota: NO toca cantidadReservada — esa se reconstruye sólo desde
 * EntregaVenta pendientes (no implementado en este replay; para
 * recalcular reservas, ver futuro `recalcularReservasPorProducto`).
 */
export async function recalcularSPDPorProducto(
  tx: TxClient,
  productoId: string,
): Promise<void> {
  const movimientos = await tx.movimientoStock.findMany({
    where: { productoId },
    orderBy: [{ fecha: "asc" }, { id: "asc" }],
    select: {
      depositoId: true,
      tipo: true,
      cantidad: true,
      costoUnitario: true,
    },
  });

  type Estado = { stock: number; promedio: Decimal };
  const porDeposito = new Map<string, Estado>();

  for (const m of movimientos) {
    const cur = porDeposito.get(m.depositoId) ?? {
      stock: 0,
      promedio: new Decimal(0),
    };
    if (m.tipo === MovimientoStockTipo.INGRESO) {
      const costoIngreso = toDecimal(m.costoUnitario);
      const nuevoStock = cur.stock + m.cantidad;
      if (cur.stock <= 0 || nuevoStock <= 0) {
        cur.promedio = costoIngreso;
      } else {
        const valorAnterior = cur.promedio.times(cur.stock);
        const valorIngreso = costoIngreso.times(m.cantidad);
        cur.promedio = valorAnterior
          .plus(valorIngreso)
          .dividedBy(nuevoStock);
      }
      cur.stock = nuevoStock;
    } else if (m.tipo === MovimientoStockTipo.EGRESO) {
      cur.stock -= m.cantidad;
    } else if (m.tipo === MovimientoStockTipo.AJUSTE) {
      cur.stock += m.cantidad;
    } else if (m.tipo === MovimientoStockTipo.TRANSFERENCIA) {
      // cantidad ya viene signed: -X en origen, +X en destino
      cur.stock += m.cantidad;
    }
    porDeposito.set(m.depositoId, cur);
  }

  // Upsert cada depósito con stock recalculado. NO borra rows existentes
  // con stock=0 para preservar history; sólo actualiza valores.
  for (const [depositoId, estado] of porDeposito) {
    await tx.stockPorDeposito.upsert({
      where: { productoId_depositoId: { productoId, depositoId } },
      create: {
        productoId,
        depositoId,
        cantidadFisica: estado.stock,
        cantidadReservada: 0,
        costoPromedio: money(estado.promedio),
      },
      update: {
        cantidadFisica: estado.stock,
        costoPromedio: money(estado.promedio),
      },
    });
  }
}
