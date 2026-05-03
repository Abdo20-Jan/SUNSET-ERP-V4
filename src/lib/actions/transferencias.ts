"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { isStockDualEnabled } from "@/lib/features";
import { AsientoError } from "@/lib/services/asiento-automatico";
import { aplicarTransferenciaSPD } from "@/lib/services/stock";
import { validarDisponible } from "@/lib/services/stock-helpers";
import {
  MovimientoStockTipo,
  Prisma,
  TransferenciaEstado,
} from "@/generated/prisma/client";

type TxClient = Prisma.TransactionClient;

const crearTransferenciaSchema = z
  .object({
    productoId: z.string().min(1),
    depositoOrigenId: z.string().min(1),
    depositoDestinoId: z.string().min(1),
    cantidad: z.number().int().positive(),
    fecha: z.coerce.date(),
    observacion: z.string().optional(),
  })
  .refine((d) => d.depositoOrigenId !== d.depositoDestinoId, {
    message: "depositoOrigenId y depositoDestinoId no pueden ser iguales.",
    path: ["depositoDestinoId"],
  });

export type CrearTransferenciaInput = z.input<typeof crearTransferenciaSchema>;

type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function generarNumeroTransferencia(tx: TxClient): Promise<string> {
  const year = new Date().getFullYear();
  const last = await tx.transferencia.findFirst({
    where: { numero: { startsWith: `T-${year}-` } },
    orderBy: { numero: "desc" },
    select: { numero: true },
  });
  const nextSeq = last
    ? Number.parseInt(last.numero.slice(`T-${year}-`.length), 10) + 1
    : 1;
  return `T-${year}-${String(nextSeq).padStart(4, "0")}`;
}

/**
 * Crea una transferencia entre depósitos en estado CONFIRMADA. Genera
 * 2 MovimientoStock TRANSFERENCIA (uno -cantidad en origen, +cantidad
 * en destino) y mueve cantidadFisica entre los SPD correspondientes.
 *
 * No genera asiento contable — es un movimiento interno de inventario.
 *
 * Sólo disponible cuando STOCK_DUAL_ENABLED=true.
 */
export async function crearTransferenciaAction(
  raw: CrearTransferenciaInput,
): Promise<ActionResult<{ transferenciaId: string; numero: string }>> {
  if (!isStockDualEnabled()) {
    return {
      ok: false,
      error: "Stock dual no está habilitado.",
    };
  }
  const parse = crearTransferenciaSchema.safeParse(raw);
  if (!parse.success) {
    const first = parse.error.issues[0];
    return {
      ok: false,
      error: first ? `${first.path.join(".")}: ${first.message}` : "Input inválido.",
    };
  }
  const input = parse.data;
  try {
    const result = await db.$transaction(async (tx) => {
      // Validar entidades
      const [producto, origen, destino] = await Promise.all([
        tx.producto.findUnique({
          where: { id: input.productoId },
          select: { id: true, codigo: true },
        }),
        tx.deposito.findUnique({
          where: { id: input.depositoOrigenId },
          select: { id: true, activo: true, nombre: true },
        }),
        tx.deposito.findUnique({
          where: { id: input.depositoDestinoId },
          select: { id: true, activo: true, nombre: true },
        }),
      ]);
      if (!producto) {
        throw new AsientoError("DOMINIO_INVALIDO", "Producto no existe.");
      }
      if (!origen || !origen.activo) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          "Depósito origen no existe o está inactivo.",
        );
      }
      if (!destino || !destino.activo) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          "Depósito destino no existe o está inactivo.",
        );
      }

      // Validar disponibilidad en origen (físico - reservado)
      await validarDisponible(
        tx,
        input.productoId,
        input.depositoOrigenId,
        input.cantidad,
      );

      const numero = await generarNumeroTransferencia(tx);
      const transferencia = await tx.transferencia.create({
        data: {
          numero,
          productoId: input.productoId,
          depositoOrigenId: input.depositoOrigenId,
          depositoDestinoId: input.depositoDestinoId,
          cantidad: input.cantidad,
          fecha: input.fecha,
          observacion: input.observacion,
          estado: TransferenciaEstado.CONFIRMADA,
        },
        select: { id: true, numero: true },
      });

      await aplicarTransferenciaSPD(tx, {
        productoId: input.productoId,
        depositoOrigenId: input.depositoOrigenId,
        depositoDestinoId: input.depositoDestinoId,
        cantidad: input.cantidad,
        fecha: input.fecha,
        transferenciaId: transferencia.id,
      });

      return transferencia;
    });
    revalidatePath("/inventario");
    revalidatePath("/inventario/transferencias");
    return { ok: true, data: { transferenciaId: result.id, numero: result.numero } };
  } catch (err) {
    if (err instanceof AsientoError) return { ok: false, error: err.message };
    return { ok: false, error: "Error al crear la transferencia." };
  }
}

/**
 * Anula una transferencia: borra los 2 MovimientoStock asociados,
 * restaura cantidadFisica en origen, decrementa en destino, marca ANULADA.
 *
 * NO valida disponibilidad en destino al revertir — si en el ínterin
 * alguien vendió de esa mercadería en destino, la cantidadFisica puede
 * quedar negativa y caería en la invariante 3. El operador debe usar
 * el validador (`pnpm db:validar-stock`) post-anulación si hay duda.
 */
export async function anularTransferenciaAction(
  transferenciaId: string,
): Promise<ActionResult> {
  if (!isStockDualEnabled()) {
    return {
      ok: false,
      error: "Stock dual no está habilitado.",
    };
  }
  try {
    await db.$transaction(async (tx) => {
      const t = await tx.transferencia.findUnique({
        where: { id: transferenciaId },
        select: {
          id: true,
          estado: true,
          productoId: true,
          depositoOrigenId: true,
          depositoDestinoId: true,
          cantidad: true,
        },
      });
      if (!t) {
        throw new AsientoError("DOMINIO_INVALIDO", "Transferencia no existe.");
      }
      if (t.estado === TransferenciaEstado.ANULADA) return;

      await tx.movimientoStock.deleteMany({
        where: {
          transferenciaId,
          tipo: MovimientoStockTipo.TRANSFERENCIA,
        },
      });

      // Restaurar SPD: origen += cantidad, destino -= cantidad.
      await tx.stockPorDeposito.update({
        where: {
          productoId_depositoId: {
            productoId: t.productoId,
            depositoId: t.depositoOrigenId,
          },
        },
        data: {
          cantidadFisica: { increment: t.cantidad },
          ultimoMovimiento: new Date(),
        },
      });
      await tx.stockPorDeposito.update({
        where: {
          productoId_depositoId: {
            productoId: t.productoId,
            depositoId: t.depositoDestinoId,
          },
        },
        data: {
          cantidadFisica: { decrement: t.cantidad },
          ultimoMovimiento: new Date(),
        },
      });

      await tx.transferencia.update({
        where: { id: transferenciaId },
        data: { estado: TransferenciaEstado.ANULADA },
      });
    });
    revalidatePath("/inventario");
    revalidatePath("/inventario/transferencias");
    return { ok: true, data: undefined };
  } catch (err) {
    if (err instanceof AsientoError) return { ok: false, error: err.message };
    return { ok: false, error: "Error al anular la transferencia." };
  }
}

export async function listarTransferencias(limit = 100) {
  return db.transferencia.findMany({
    orderBy: [{ fecha: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      id: true,
      numero: true,
      fecha: true,
      cantidad: true,
      estado: true,
      observacion: true,
      producto: { select: { codigo: true, nombre: true } },
      origen: { select: { id: true, nombre: true } },
      destino: { select: { id: true, nombre: true } },
    },
  });
}
