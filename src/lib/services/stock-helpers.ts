import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { TipoDeposito } from "@/generated/prisma/client";
import { AsientoError } from "@/lib/services/asiento-automatico";

type TxClient = Prisma.TransactionClient;

/**
 * Lookup de StockPorDeposito por (productoId, depositoId). Devuelve
 * `null` si todavía no se materializó (caso de un producto que nunca
 * tuvo movimiento en ese depósito).
 */
export async function getStockPorDeposito(tx: TxClient, productoId: string, depositoId: string) {
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
 *  1. Primer Deposito activo de tipo NACIONAL en orden alfabético.
 *  2. Fallback histórico: nombre exacto "NACIONAL" activo (instalaciones
 *     pre-Fase A donde el campo `tipo` todavía no fue marcado vía
 *     prisma/backfill-tipo-deposito.ts).
 *  3. Si no hay nada disponible, throw AsientoError DOMINIO_INVALIDO.
 *
 * NUNCA devuelve depósito tipo ZONA_PRIMARIA — mercadería ahí está bajo
 * custodia aduanera y no es vendable.
 */
export async function getDepositoPorDefecto(tx: TxClient): Promise<string> {
  const porTipo = await tx.deposito.findFirst({
    where: { tipo: TipoDeposito.NACIONAL, activo: true },
    orderBy: { nombre: "asc" },
    select: { id: true },
  });
  if (porTipo) return porTipo.id;

  // Fallback: instalación sin backfill — buscar por nombre.
  const porNombre = await tx.deposito.findFirst({
    where: { nombre: "NACIONAL", activo: true },
    select: { id: true },
  });
  if (porNombre) return porNombre.id;

  throw new AsientoError(
    "DOMINIO_INVALIDO",
    "No hay depósito tipo NACIONAL activo configurado en el sistema.",
  );
}

/**
 * Valida que el depósito no sea de tipo ZONA_PRIMARIA. Usado por
 * operaciones de venta/entrega para impedir bypass del filtro de UI.
 * No-op si el depósito es NACIONAL.
 */
export async function validarDepositoVenta(tx: TxClient, depositoId: string): Promise<void> {
  const deposito = await tx.deposito.findUnique({
    where: { id: depositoId },
    select: { nombre: true, tipo: true, activo: true },
  });
  if (!deposito) {
    throw new AsientoError("DOMINIO_INVALIDO", `Depósito ${depositoId} no encontrado.`);
  }
  if (!deposito.activo) {
    throw new AsientoError("DOMINIO_INVALIDO", `Depósito "${deposito.nombre}" está inactivo.`);
  }
  if (deposito.tipo === TipoDeposito.ZONA_PRIMARIA) {
    throw new AsientoError(
      "DOMINIO_INVALIDO",
      `Depósito "${deposito.nombre}" es tipo Zona Primaria — mercadería bajo custodia aduanera, no disponible para venta. Espere a la nacionalización del despacho.`,
    );
  }
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
