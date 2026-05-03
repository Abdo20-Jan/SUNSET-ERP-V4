import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { AsientoError } from "@/lib/services/asiento-automatico";

type TxClient = Prisma.TransactionClient;

/**
 * Lookup de StockPorDeposito por (productoId, depositoId). Devuelve
 * `null` si todavía no se materializó (caso de un producto que nunca
 * tuvo movimiento en ese depósito).
 */
export async function getStockPorDeposito(
  tx: TxClient,
  productoId: string,
  depositoId: string,
) {
  return tx.stockPorDeposito.findUnique({
    where: { productoId_depositoId: { productoId, depositoId } },
    select: {
      id: true,
      cantidadFisica: true,
      cantidadReservada: true,
      costoPromedio: true,
    },
  });
}

/**
 * Idempotente: si ya existe StockPorDeposito devuelve el id; si no
 * existe, lo crea con cantidades 0 y costo 0. Útil antes de aplicar
 * un ingreso o egreso para garantizar que el row existe.
 */
export async function ensureStockPorDeposito(
  tx: TxClient,
  productoId: string,
  depositoId: string,
): Promise<string> {
  const existing = await tx.stockPorDeposito.findUnique({
    where: { productoId_depositoId: { productoId, depositoId } },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await tx.stockPorDeposito.create({
    data: { productoId, depositoId },
    select: { id: true },
  });
  return created.id;
}

/**
 * Resuelve el depósito por defecto para emisión de venta (cuando el
 * operador no eligió uno explícitamente). Estrategia:
 *  1. Si existe un Deposito activo con nombre exacto "NACIONAL", devolverlo.
 *  2. Caso contrario, devolver el primer Deposito activo en orden alfabético.
 *  3. Si no hay ningún Deposito activo, throw `AsientoError` DOMINIO_INVALIDO.
 *
 * Nota: instalaciones pre-W3 pueden tener depósitos con nomenclatura
 * propia (ej: "Depósito Principal — Buenos Aires"); en esos casos cae
 * en la regla 2.
 */
export async function getDepositoPorDefecto(tx: TxClient): Promise<string> {
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
    throw new AsientoError(
      "DOMINIO_INVALIDO",
      "No hay ningún depósito activo configurado en el sistema.",
    );
  }
  return primero.id;
}

/**
 * Valida que haya stock disponible (`cantidadFisica - cantidadReservada`)
 * suficiente para `cantidadRequerida` en el (producto, depósito) dado.
 *
 * - Si `cantidadRequerida <= 0`, no-op.
 * - Si todavía no existe `StockPorDeposito` para ese par, considera
 *   disponible = 0 → throw si requerida > 0.
 * - Si disponible < requerida, throw `AsientoError` DOMINIO_INVALIDO
 *   con detalle de cantidades para diagnóstico.
 */
export async function validarDisponible(
  tx: TxClient,
  productoId: string,
  depositoId: string,
  cantidadRequerida: number,
): Promise<void> {
  if (cantidadRequerida <= 0) {
    return;
  }
  const stock = await getStockPorDeposito(tx, productoId, depositoId);
  const fisica = stock?.cantidadFisica ?? 0;
  const reservada = stock?.cantidadReservada ?? 0;
  const disponible = fisica - reservada;
  if (disponible < cantidadRequerida) {
    throw new AsientoError(
      "DOMINIO_INVALIDO",
      `Stock insuficiente: producto ${productoId} en depósito ${depositoId} tiene ${disponible} disponible (físico ${fisica} - reservado ${reservada}), operación requiere ${cantidadRequerida}.`,
    );
  }
}
