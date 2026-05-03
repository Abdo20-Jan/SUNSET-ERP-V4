"use server";

import { db } from "@/lib/db";

/**
 * Devuelve la matriz de stock por (producto, depósito) para la UI de
 * inventario. Filtra productos activos. Orden estable por código.
 */
export async function listarMatrizInventario(opts?: {
  search?: string;
  take?: number;
}) {
  const search = opts?.search?.trim();
  const take = opts?.take ?? 100;

  const productos = await db.producto.findMany({
    where: {
      activo: true,
      ...(search
        ? {
            OR: [
              { codigo: { contains: search, mode: "insensitive" } },
              { nombre: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { codigo: "asc" },
    take,
    select: {
      id: true,
      codigo: true,
      nombre: true,
      stockActual: true,
      costoPromedio: true,
      stockPorDeposito: {
        select: {
          depositoId: true,
          cantidadFisica: true,
          cantidadReservada: true,
          costoPromedio: true,
        },
      },
    },
  });

  const depositos = await db.deposito.findMany({
    where: { activo: true },
    orderBy: { nombre: "asc" },
    select: { id: true, nombre: true },
  });

  return { productos, depositos };
}

/**
 * Lista productos con stock total > 0 (sumando todos los depósitos),
 * útil para el selector del form de transferencia.
 */
export async function listarProductosConStock() {
  return db.producto.findMany({
    where: { activo: true, stockActual: { gt: 0 } },
    orderBy: { codigo: "asc" },
    select: { id: true, codigo: true, nombre: true, stockActual: true },
  });
}
