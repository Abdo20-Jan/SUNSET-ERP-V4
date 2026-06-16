/**
 * Funções de recálculo de SPD que precisam rodar fora do runtime Next.js
 * (CI, scripts standalone). Mantidas neste arquivo SEM `import "server-only"`
 * para que `prisma/validar-invariantes-stock.ts` possa importar.
 *
 * As funções aqui só recebem `Prisma.TransactionClient` — não usam helpers
 * de auth, headers ou outras APIs server-only.
 */

import { MovimientoStockTipo, type Prisma, TipoDeposito } from "@/generated/prisma/client";
import { type MoneyInput, toDecimal } from "@/lib/decimal";
import Decimal from "decimal.js";

type TxClient = Prisma.TransactionClient;

/**
 * Promedio ponderado: nuevo_promedio = (stock_anterior × promedio_anterior
 * + cantidad × costo_ingreso) / (stock_anterior + cantidad). Si no hay stock
 * previo, el promedio es el costo del ingreso. Función pura — compartida por
 * `stock.ts` (runtime) y los scripts de `prisma/` (tsx), para que no diverjan.
 */
export function calcularNuevoPromedio(
  stockAnterior: number,
  promedioAnterior: Decimal,
  cantidadIngreso: number,
  costoIngreso: Decimal,
): Decimal {
  const nuevoStock = stockAnterior + cantidadIngreso;
  if (stockAnterior <= 0 || nuevoStock <= 0) {
    return costoIngreso;
  }
  const valorAnterior = promedioAnterior.times(stockAnterior);
  const valorIngreso = costoIngreso.times(cantidadIngreso);
  return valorAnterior.plus(valorIngreso).dividedBy(nuevoStock);
}

/** Movimiento mínimo necesario para reproducir el agregado vendible. */
export type MovimientoStockReplay = {
  tipo: MovimientoStockTipo;
  cantidad: number;
  costoUnitario: MoneyInput;
  /** Tipo del depósito de la pata — sólo NACIONAL entra al agregado vendible. */
  depositoTipo: TipoDeposito;
};

/**
 * Reproduce `Producto.stockActual` / `costoPromedio` (campos legacy globales)
 * a partir de los MovimientoStock ordenados (fecha, id). SÓLO cuenta las patas
 * en depósitos NACIONAL (la mercadería bonded no es vendable). Reglas:
 *  - INGRESO        → suma cantidad y promedia el costo.
 *  - EGRESO         → resta cantidad (cantidad positiva).
 *  - AJUSTE         → suma cantidad signada; mantiene el promedio.
 *  - TRANSFERENCIA  → cantidad signada; la entrada (>0) promedia el costo
 *                     landed nacionalizado, la salida (<0) sólo resta.
 *
 * Es la única fuente de verdad del replay: `recalcularStockYCostoPromedio`
 * (stock.ts) y `prisma/fix-recalcular-stock-actual.ts` la consumen.
 */
export function replayStockNacional(movimientos: readonly MovimientoStockReplay[]): {
  stock: number;
  promedio: Decimal;
} {
  let stock = 0;
  let promedio = new Decimal(0);

  for (const m of movimientos) {
    if (m.depositoTipo !== TipoDeposito.NACIONAL) continue;

    if (m.tipo === MovimientoStockTipo.INGRESO) {
      promedio = calcularNuevoPromedio(stock, promedio, m.cantidad, toDecimal(m.costoUnitario));
      stock += m.cantidad;
    } else if (m.tipo === MovimientoStockTipo.EGRESO) {
      stock -= m.cantidad;
    } else if (m.tipo === MovimientoStockTipo.AJUSTE) {
      stock += m.cantidad;
    } else if (m.tipo === MovimientoStockTipo.TRANSFERENCIA) {
      if (m.cantidad > 0) {
        promedio = calcularNuevoPromedio(stock, promedio, m.cantidad, toDecimal(m.costoUnitario));
      }
      stock += m.cantidad; // cantidad ya viene signada
    }
  }

  return { stock, promedio };
}

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
