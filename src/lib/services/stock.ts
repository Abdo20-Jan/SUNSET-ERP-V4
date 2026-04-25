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
