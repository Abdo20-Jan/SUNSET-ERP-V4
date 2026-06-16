import "server-only";

import Decimal from "decimal.js";

import { MovimientoStockTipo, TipoDeposito, type Prisma } from "@/generated/prisma/client";
import { money, toDecimal } from "@/lib/decimal";
import { AsientoError } from "@/lib/services/asiento-automatico";
import { calcularNuevoPromedio, replayStockNacional } from "@/lib/services/stock-recalc";

type TxClient = Prisma.TransactionClient;

type IngresoItem = {
  itemEmbarqueId: number;
  productoId: string;
  cantidad: number;
  costoUnitario: Decimal;
};

// `calcularNuevoPromedio` (promedio ponderado) y `replayStockNacional` viven
// en `stock-recalc.ts` (sin `server-only`) para que los scripts de `prisma/`
// consuman la MISMA fórmula que el runtime y no diverjan.

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
    throw new AsientoError("DOMINIO_INVALIDO", "El depósito de destino del embarque no existe.");
  }
  if (!deposito.activo) {
    throw new AsientoError("DOMINIO_INVALIDO", "El depósito de destino está inactivo.");
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
      params.depositoDestinoId,
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
 * Incrementa `Producto.stockActual`/`costoPromedio` por un ingreso, SÓLO si
 * el depósito destino es `tipo=NACIONAL` (stock vendable). Para depósitos
 * `ZONA_PRIMARIA` (puerto / depósito fiscal) no toca el agregado del Producto:
 * ese stock no es vendable hasta nacionalizarse (vive sólo en SPD + cuentas
 * 1.1.5.04/05). Coherente con `recalcularStockYCostoPromedio`.
 */
async function aplicarIngresoProducto(
  tx: TxClient,
  productoId: string,
  depositoId: string,
  cantidadIngreso: number,
  costoUnitarioIngreso: Decimal,
): Promise<void> {
  const deposito = await tx.deposito.findUnique({
    where: { id: depositoId },
    select: { tipo: true },
  });
  // Sólo el stock en depósitos NACIONAL alimenta el agregado del Producto.
  if (deposito?.tipo !== TipoDeposito.NACIONAL) return;

  const producto = await tx.producto.findUnique({
    where: { id: productoId },
    select: { stockActual: true, costoPromedio: true },
  });
  if (!producto) {
    throw new AsientoError("DOMINIO_INVALIDO", `El producto ${productoId} no existe.`);
  }

  const stockActual = producto.stockActual;
  const nuevoCostoPromedio = calcularNuevoPromedio(
    stockActual,
    toDecimal(producto.costoPromedio),
    cantidadIngreso,
    costoUnitarioIngreso,
  );

  await tx.producto.update({
    where: { id: productoId },
    data: {
      stockActual: stockActual + cantidadIngreso,
      costoPromedio: money(nuevoCostoPromedio),
    },
  });
}

/**
 * Aplica el ingreso de stock a un depósito tipo ZONA_PRIMARIA generado
 * al confirmar la Zona Primaria del embarque. Mismo mecanismo que
 * aplicarIngresoEmbarque, pero exige que el depósito sea de tipo
 * ZONA_PRIMARIA — si no, falla con mensaje claro.
 *
 * El stock entra físicamente al depósito ZPA. Quedará luego para
 * transferirse al depósito Nacional al contabilizar el despacho (Fase C).
 *
 * Los `MovimientoStock` quedan ligados al `itemEmbarqueId`, idéntico
 * a aplicarIngresoEmbarque, permitiendo reversión limpia via
 * revertirIngresoEmbarque al revertir la Zona Primaria.
 */
export async function aplicarIngresoEmbarqueZpa(
  tx: TxClient,
  params: {
    depositoZpaId: string;
    fecha: Date;
    items: readonly IngresoItem[];
  },
): Promise<void> {
  const deposito = await tx.deposito.findUnique({
    where: { id: params.depositoZpaId },
    select: { id: true, nombre: true, activo: true, tipo: true },
  });
  if (!deposito) {
    throw new AsientoError("DOMINIO_INVALIDO", "El depósito ZPA no existe.");
  }
  if (!deposito.activo) {
    throw new AsientoError(
      "DOMINIO_INVALIDO",
      `El depósito ZPA "${deposito.nombre}" está inactivo.`,
    );
  }
  if (deposito.tipo !== TipoDeposito.ZONA_PRIMARIA) {
    throw new AsientoError(
      "DOMINIO_INVALIDO",
      `El depósito "${deposito.nombre}" no es tipo Zona Primaria. Marcalo en /maestros/depositos o use otro depósito.`,
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
        depositoId: params.depositoZpaId,
        tipo: MovimientoStockTipo.INGRESO,
        cantidad: item.cantidad,
        costoUnitario: money(item.costoUnitario),
        fecha: params.fecha,
        itemEmbarqueId: item.itemEmbarqueId,
      },
    });

    // ZPA: depósito tipo ZONA_PRIMARIA. aplicarIngresoProducto NO toca el
    // agregado del Producto (no es stock vendable hasta nacionalizar), pero se
    // llama por consistencia y para mantener SPD.
    await aplicarIngresoProducto(
      tx,
      item.productoId,
      params.depositoZpaId,
      item.cantidad,
      item.costoUnitario,
    );
    await aplicarIngresoSPD(
      tx,
      item.productoId,
      params.depositoZpaId,
      item.cantidad,
      item.costoUnitario,
    );
  }
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
    throw new AsientoError("DOMINIO_INVALIDO", "El depósito de destino del despacho no existe.");
  }
  if (!deposito.activo) {
    throw new AsientoError("DOMINIO_INVALIDO", "El depósito de destino está inactivo.");
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
      params.depositoDestinoId,
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
export async function revertirIngresoDespacho(tx: TxClient, despachoId: string): Promise<void> {
  const items = await tx.itemDespacho.findMany({
    where: { despachoId },
    select: { id: true, itemEmbarque: { select: { productoId: true } } },
  });
  if (items.length === 0) return;

  const itemIds = items.map((i) => i.id);
  const productoIds = Array.from(new Set(items.map((i) => i.itemEmbarque.productoId)));

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
export async function revertirIngresoEmbarque(tx: TxClient, embarqueId: string): Promise<void> {
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
 * Replays los `MovimientoStock` del producto en orden cronológico para
 * reconstruir `stockActual` y `costoPromedio` desde cero, contando SÓLO el
 * stock NACIONALIZADO (vendable): movimientos en depósitos `tipo=NACIONAL`.
 *
 * Decisión (Comex Modelo Y): `Producto.stockActual`/`costoPromedio` reflejan
 * únicamente la mercadería disponible para la venta. La mercadería en zona
 * primaria / depósito fiscal (`tipo=ZONA_PRIMARIA`) NO es vendable hasta su
 * nacionalización, por eso se ignora en el agregado a nivel Producto (vive en
 * `StockPorDeposito` y en las cuentas 1.1.5.04/05). El criterio es
 * `Deposito.tipo`.
 *
 * Reglas (sólo depósitos NACIONAL):
 *  - INGRESO          → suma cantidad y promedia costo (costo landed).
 *  - EGRESO           → resta cantidad (mantiene costo medio).
 *  - AJUSTE           → cantidad signada; mantiene costo medio.
 *  - TRANSFERENCIA    → cada par tiene 2 movimientos (origen cantidad<0,
 *                       destino cantidad>0). La pata DESTINO en NACIONAL es
 *                       una ENTRADA (suma + promedia el costo de la
 *                       transferencia → costo landed nacionalizado); la pata
 *                       ORIGEN en NACIONAL es una SALIDA (resta). Las patas en
 *                       depósitos ZONA_PRIMARIA se ignoran.
 */
export async function recalcularStockYCostoPromedio(
  tx: TxClient,
  productoId: string,
): Promise<void> {
  const movimientos = await tx.movimientoStock.findMany({
    where: { productoId },
    orderBy: [{ fecha: "asc" }, { id: "asc" }],
    select: {
      tipo: true,
      cantidad: true,
      costoUnitario: true,
      deposito: { select: { tipo: true } },
    },
  });

  const { stock, promedio } = replayStockNacional(
    movimientos.map((m) => ({
      tipo: m.tipo,
      cantidad: m.cantidad,
      costoUnitario: m.costoUnitario,
      depositoTipo: m.deposito.tipo,
    })),
  );

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
  const nuevoPromedio = calcularNuevoPromedio(
    stockActual,
    toDecimal(existing.costoPromedio),
    cantidadIngreso,
    costoUnitarioIngreso,
  );
  await tx.stockPorDeposito.update({
    where: { productoId_depositoId: { productoId, depositoId } },
    data: {
      cantidadFisica: stockActual + cantidadIngreso,
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
    // Override opcional del costo unitario. Útil para la transferencia
    // automática de despacho ZPA→Nacional, donde queremos preservar el
    // costo original del ItemEmbarque (no el promedio mezclado de la
    // ZPA si hay varios embarques).
    costoUnitarioOverride?: Decimal;
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
  const costoUnitario = params.costoUnitarioOverride ?? toDecimal(origen.costoPromedio);

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

type TransferenciaDespachoItem = {
  productoId: string;
  cantidad: number;
  /** Costo unitario del ItemEmbarque-pai — preservado del rateio ZPA. */
  costoUnitario: Decimal;
};

/**
 * Aplica las transferencias de stock generadas por contabilizar un
 * Despacho parcial: por cada ItemDespacho, mueve la cantidad despachada
 * desde el depósito ZPA al depósito destino del embarque (típicamente
 * NACIONAL). Crea 1 `Transferencia` row por producto + 2 MovimientoStock
 * (egreso ZPA + ingreso destino).
 *
 * Usa `costoUnitarioOverride` igual al ItemEmbarque.costoUnitario para
 * preservar el costo FOB+ZP original del embarque-pai, evitando que la
 * media ponderada de la ZPA (potencialmente mezclada con otros embarques)
 * contamine el costo del stock nacionalizado.
 *
 * NO pasa por crearTransferenciaAction (que es feature-flagged para uso
 * manual). Esta vía es automática y siempre activa.
 */
export async function aplicarTransferenciaDespacho(
  tx: TxClient,
  params: {
    despachoId: string;
    despachoCodigo: string;
    depositoZpaId: string;
    depositoDestinoId: string;
    fecha: Date;
    items: readonly TransferenciaDespachoItem[];
  },
): Promise<void> {
  if (params.depositoZpaId === params.depositoDestinoId) {
    throw new AsientoError(
      "DOMINIO_INVALIDO",
      "El depósito de origen y destino del despacho no pueden ser el mismo.",
    );
  }

  for (const item of params.items) {
    const numero = await siguienteNumeroTransferenciaDespacho(tx, params.despachoCodigo);
    const transferencia = await tx.transferencia.create({
      data: {
        numero,
        productoId: item.productoId,
        depositoOrigenId: params.depositoZpaId,
        depositoDestinoId: params.depositoDestinoId,
        cantidad: item.cantidad,
        fecha: params.fecha,
        despachoId: params.despachoId,
        observacion: `Despacho ${params.despachoCodigo} — transferencia automática ZPA → destino`,
        // estado default = CONFIRMADA
      },
      select: { id: true },
    });

    await aplicarTransferenciaSPD(tx, {
      productoId: item.productoId,
      depositoOrigenId: params.depositoZpaId,
      depositoDestinoId: params.depositoDestinoId,
      cantidad: item.cantidad,
      fecha: params.fecha,
      transferenciaId: transferencia.id,
      costoUnitarioOverride: item.costoUnitario,
    });
  }

  // El destino es típicamente NACIONAL: recalcular el agregado del Producto
  // (stockActual/costoPromedio) que la transferencia acaba de alimentar con
  // el costo landed. recalcularStockYCostoPromedio filtra por Deposito.tipo,
  // así que sólo cuenta las patas en depósitos NACIONAL.
  const productoIds = Array.from(new Set(params.items.map((i) => i.productoId)));
  for (const productoId of productoIds) {
    await recalcularStockYCostoPromedio(tx, productoId);
  }
}

type NacionalizacionDFItem = {
  productoId: string;
  cantidad: number;
  /** Costo unitario LANDED en ARS (costoFC×TC + capitalizables prorrateados),
   *  computado por `calcularCostoLandedDespacho` — la misma fuente que el
   *  DEBE 1.1.5.01 del asiento. Es el costo del stock NACIONALIZADO (vendable). */
  costoUnitario: Decimal;
  /** Depósito fiscal de origen — puede diferir por línea (un despacho cruzado
   *  consume de N contenedores, potencialmente en DF distintos). */
  depositoFiscalId: string;
};

/**
 * Aplica el movimiento físico de stock al nacionalizar un despacho parcial
 * CRUZADO (Fase 4): por cada línea, transfiere la cantidad desde el depósito
 * fiscal del contenedor de origen al depósito destino del embarque. Espeja a
 * `aplicarTransferenciaDespacho` (1 `Transferencia` + 2 MovimientoStock vía
 * `aplicarTransferenciaSPD`), pero el origen es el DF (no la ZPA) y el costo
 * es el costo LANDED del ItemDespacho (FC + tributos/facturas capitalizados).
 *
 * Contablemente acompaña al asiento NACIONALIZACION_VIA_DF (DEBE 1.1.5.01 /
 * HABER 1.1.5.05). El stock en el DF fue ingresado al desconsolidar (PR 3.2).
 * Al final recalcula `Producto.stockActual`/`costoPromedio` (sólo NACIONAL).
 */
export async function aplicarNacionalizacionDF(
  tx: TxClient,
  params: {
    despachoId: string;
    despachoCodigo: string;
    depositoDestinoId: string;
    fecha: Date;
    items: readonly NacionalizacionDFItem[];
  },
): Promise<void> {
  for (const item of params.items) {
    if (item.depositoFiscalId === params.depositoDestinoId) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        "El depósito fiscal de origen y el destino del despacho no pueden ser el mismo.",
      );
    }
    const numero = await siguienteNumeroTransferenciaDespacho(tx, params.despachoCodigo);
    const transferencia = await tx.transferencia.create({
      data: {
        numero,
        productoId: item.productoId,
        depositoOrigenId: item.depositoFiscalId,
        depositoDestinoId: params.depositoDestinoId,
        cantidad: item.cantidad,
        fecha: params.fecha,
        despachoId: params.despachoId,
        observacion: `Despacho ${params.despachoCodigo} — nacionalización depósito fiscal → destino`,
        // estado default = CONFIRMADA
      },
      select: { id: true },
    });

    await aplicarTransferenciaSPD(tx, {
      productoId: item.productoId,
      depositoOrigenId: item.depositoFiscalId,
      depositoDestinoId: params.depositoDestinoId,
      cantidad: item.cantidad,
      fecha: params.fecha,
      transferenciaId: transferencia.id,
      costoUnitarioOverride: item.costoUnitario,
    });
  }

  // El destino es NACIONAL: recalcular el agregado del Producto con el costo
  // landed que la nacionalización acaba de ingresar. recalcularStockYCostoPromedio
  // sólo cuenta movimientos en depósitos NACIONAL (la pata DF se ignora).
  const productoIds = Array.from(new Set(params.items.map((i) => i.productoId)));
  for (const productoId of productoIds) {
    await recalcularStockYCostoPromedio(tx, productoId);
  }
}

async function siguienteNumeroTransferenciaDespacho(
  tx: TxClient,
  despachoCodigo: string,
): Promise<string> {
  // Número derivado del código del despacho + sufijo incremental para
  // soportar múltiples productos en el mismo despacho.
  const prefix = `${despachoCodigo}-T`;
  const existentes = await tx.transferencia.count({
    where: { numero: { startsWith: prefix } },
  });
  return `${prefix}${existentes + 1}`;
}

/**
 * Tras revertir transferencias (borrar sus MovimientoStock), recalcula el
 * estado de stock de los productos afectados desde los movimientos restantes:
 *  1. SPD por depósito (`recalcularSPDPorProducto`).
 *  2. Agregado `Producto.stockActual`/`costoPromedio` (`recalcularStockYCostoPromedio`,
 *     sólo NACIONAL) — imprescindible para que el CMV de la próxima venta no
 *     use un costo stale.
 *  3. Zera los depósitos que quedaron sin ningún movimiento: un destino
 *     alimentado SÓLO por la transferencia revertida quedaría con stock
 *     fantasma, porque `recalcularSPDPorProducto` sólo toca depósitos presentes
 *     en algún MovimientoStock.
 * `afectados` mapea cada producto → depósitos tocados por la reversión.
 */
export async function recalcularTrasReversionTransferencia(
  tx: TxClient,
  afectados: Map<string, Set<string>>,
): Promise<void> {
  for (const [productoId, depositos] of afectados) {
    await recalcularSPDPorProducto(tx, productoId);
    await recalcularStockYCostoPromedio(tx, productoId);
    for (const depositoId of depositos) {
      const movs = await tx.movimientoStock.count({ where: { productoId, depositoId } });
      if (movs === 0) {
        // Un depósito sin ningún movimiento no tiene base física: zera también
        // `cantidadReservada` para no dejar disponible negativo (fisica 0 con
        // reserva > 0). Una reserva sobre un depósito huérfano ya es inválida.
        await tx.stockPorDeposito.updateMany({
          where: { productoId, depositoId },
          data: { cantidadFisica: 0, cantidadReservada: 0, costoPromedio: 0 },
        });
      }
    }
  }
}

/**
 * Revierte las transferencias de stock generadas por un despacho.
 * Deleta los MovimientoStock + Transferencia ligados al despacho y recalcula
 * SPD + agregado `Producto` de los productos afectados. Usado al anular
 * despacho que usaba flujo ZPA (Fase C).
 */
export async function revertirTransferenciaDespacho(
  tx: TxClient,
  despachoId: string,
): Promise<void> {
  const transferencias = await tx.transferencia.findMany({
    where: { despachoId },
    select: { id: true, productoId: true, depositoOrigenId: true, depositoDestinoId: true },
  });
  if (transferencias.length === 0) return;

  const transferenciaIds = transferencias.map((t) => t.id);

  // Depósitos (producto→depósitos) tocados por las transferencias a borrar.
  // Tras el recalc, los que queden sin ningún movimiento deben caer a 0:
  // `recalcularSPDPorProducto` sólo actualiza depósitos presentes en algún
  // MovimientoStock, así que un depósito que recibió SÓLO esta transferencia
  // (típico del destino del despacho) quedaría con stock fantasma si no se
  // limpia explícitamente. Acotado a los depósitos de esta reversión para no
  // tocar saldos mantenidos incrementalmente por otros flujos.
  const afectados = new Map<string, Set<string>>();
  for (const t of transferencias) {
    const set = afectados.get(t.productoId) ?? new Set<string>();
    set.add(t.depositoOrigenId);
    set.add(t.depositoDestinoId);
    afectados.set(t.productoId, set);
  }

  // Borrar movimientos antes de las transferencias (FK).
  await tx.movimientoStock.deleteMany({
    where: { transferenciaId: { in: transferenciaIds } },
  });
  await tx.transferencia.deleteMany({
    where: { id: { in: transferenciaIds } },
  });

  await recalcularTrasReversionTransferencia(tx, afectados);
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
export async function recalcularSPDPorProducto(tx: TxClient, productoId: string): Promise<void> {
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
      cur.promedio = calcularNuevoPromedio(
        cur.stock,
        cur.promedio,
        m.cantidad,
        toDecimal(m.costoUnitario),
      );
      cur.stock += m.cantidad;
    } else if (m.tipo === MovimientoStockTipo.EGRESO) {
      cur.stock -= m.cantidad;
    } else if (m.tipo === MovimientoStockTipo.AJUSTE) {
      // AJUSTE: cantidad signed; mantiene el costo medio del depósito.
      cur.stock += m.cantidad;
    } else if (m.tipo === MovimientoStockTipo.TRANSFERENCIA) {
      // cantidad > 0 = entrada al depósito: promedia el costo landed que trae
      // el movimiento (si no, un depósito alimentado sólo por transferencias
      // quedaría con costoPromedio 0). cantidad < 0 = salida: resta sin diluir
      // el promedio. Espeja recalcularStockYCostoPromedio (agregado global).
      if (m.cantidad > 0) {
        cur.promedio = calcularNuevoPromedio(
          cur.stock,
          cur.promedio,
          m.cantidad,
          toDecimal(m.costoUnitario),
        );
      }
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

// `recalcularReservasPorProducto` movida a `stock-recalc.ts` (sin
// `server-only`) para que el validador standalone (CI) pueda importarla.
export { recalcularReservasPorProducto } from "@/lib/services/stock-recalc";
