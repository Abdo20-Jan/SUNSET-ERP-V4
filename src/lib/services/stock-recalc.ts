/**
 * Funções de recálculo de SPD que precisam rodar fora do runtime Next.js
 * (CI, scripts standalone). Mantidas neste arquivo SEM `import "server-only"`
 * para que `prisma/validar-invariantes-stock.ts` possa importar.
 *
 * As funções aqui só recebem `Prisma.TransactionClient` — não usam helpers
 * de auth, headers ou outras APIs server-only.
 */

import type { Prisma } from "@/generated/prisma/client";

type TxClient = Prisma.TransactionClient;

/**
 * S3.3 — Recalcula `StockPorDeposito.cantidadReservada` para um
 * produto a partir do estado atual de ventas/entregas.
 *
 * Reservas vivas = items de Ventas em estado EMITIDA cuya cantidad
 * todavía no fue cubierta por una entrega no-anulada. Se agrupa por
 * depósito (default global hasta que S3.1 entregue `ItemVenta.depositoId`,
 * después se debe usar `it.depositoId ?? defaultDepId`).
 *
 * Estrategia:
 *  1. Zera `cantidadReservada` de todos los SPD del producto.
 *  2. Itera ItemVenta de ventas EMITIDA y suma cantidad pendiente.
 *  3. Upsert el SPD del depósito con la cantidad reservada calculada.
 */
export async function recalcularReservasPorProducto(
  tx: TxClient,
  productoId: string,
): Promise<void> {
  await tx.stockPorDeposito.updateMany({
    where: { productoId },
    data: { cantidadReservada: 0 },
  });

  const items = await tx.itemVenta.findMany({
    where: {
      productoId,
      venta: { estado: "EMITIDA" },
    },
    select: {
      cantidad: true,
      itemsEntrega: {
        where: { entrega: { estado: { not: "ANULADA" } } },
        select: { cantidad: true },
      },
    },
  });

  const defaultDepId = await getDepositoPorDefectoTx(tx);
  const pendientesPorDep = new Map<string, number>();
  for (const it of items) {
    const entregadas = it.itemsEntrega.reduce((sum, ie) => sum + ie.cantidad, 0);
    const pendiente = it.cantidad - entregadas;
    if (pendiente <= 0) continue;
    pendientesPorDep.set(defaultDepId, (pendientesPorDep.get(defaultDepId) ?? 0) + pendiente);
  }

  for (const [depositoId, qty] of pendientesPorDep) {
    await tx.stockPorDeposito.upsert({
      where: { productoId_depositoId: { productoId, depositoId } },
      create: {
        productoId,
        depositoId,
        cantidadFisica: 0,
        cantidadReservada: qty,
        costoPromedio: 0,
      },
      update: { cantidadReservada: qty },
    });
  }
}

async function getDepositoPorDefectoTx(tx: TxClient): Promise<string> {
  const nacional = await tx.deposito.findFirst({
    where: { nombre: "NACIONAL", activo: true },
    select: { id: true },
  });
  if (nacional) return nacional.id;
  const primero = await tx.deposito.findFirst({
    where: { activo: true },
    orderBy: { nombre: "asc" },
    select: { id: true },
  });
  if (!primero) {
    throw new Error("No hay ningún depósito activo configurado.");
  }
  return primero.id;
}
