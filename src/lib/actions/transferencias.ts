"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { isStockDualEnabled } from "@/lib/features";
import { AsientoError } from "@/lib/services/asiento-automatico";
import { aplicarTransferenciaSPD } from "@/lib/services/stock";
import { validarDisponible } from "@/lib/services/stock-helpers";
import { MovimientoStockTipo, type Prisma, TransferenciaEstado } from "@/generated/prisma/client";

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

type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const FLAG_OFF_ERROR = {
  ok: false as const,
  error: "Stock dual no está habilitado.",
};

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

async function generarNumeroTransferencia(tx: TxClient): Promise<string> {
  const year = new Date().getFullYear();
  const last = await tx.transferencia.findFirst({
    where: { numero: { startsWith: `T-${year}-` } },
    orderBy: { numero: "desc" },
    select: { numero: true },
  });
  const nextSeq = last ? Number.parseInt(last.numero.slice(`T-${year}-`.length), 10) + 1 : 1;
  return `T-${year}-${String(nextSeq).padStart(4, "0")}`;
}

function parseTransferenciaInput(
  raw: CrearTransferenciaInput,
): z.infer<typeof crearTransferenciaSchema> {
  const parse = crearTransferenciaSchema.safeParse(raw);
  if (!parse.success) {
    const first = parse.error.issues[0];
    throw new AsientoError(
      "DOMINIO_INVALIDO",
      first ? `${first.path.join(".")}: ${first.message}` : "Input inválido.",
    );
  }
  return parse.data;
}

async function ensureProductoExiste(tx: TxClient, productoId: string): Promise<void> {
  const p = await tx.producto.findUnique({
    where: { id: productoId },
    select: { id: true },
  });
  if (!p) {
    throw new AsientoError("DOMINIO_INVALIDO", "Producto no existe.");
  }
}

async function ensureDepositoActivoConId(
  tx: TxClient,
  depositoId: string,
  rol: "origen" | "destino",
): Promise<void> {
  const dep = await tx.deposito.findUnique({
    where: { id: depositoId },
    select: { id: true, activo: true },
  });
  if (!dep || !dep.activo) {
    throw new AsientoError("DOMINIO_INVALIDO", `Depósito ${rol} no existe o está inactivo.`);
  }
}

/**
 * Mueve `cantidadFisica` entre dos SPD. Usado tanto al crear (vía
 * aplicarTransferenciaSPD) como al anular (en sentido inverso). Útil
 * para evitar duplicar el patrón {increment} / {decrement}.
 */
async function moverCantidadFisica(
  tx: TxClient,
  productoId: string,
  depositoOrigenId: string,
  depositoDestinoId: string,
  cantidad: number,
): Promise<void> {
  const now = new Date();
  await tx.stockPorDeposito.update({
    where: {
      productoId_depositoId: { productoId, depositoId: depositoOrigenId },
    },
    data: {
      cantidadFisica: { increment: cantidad },
      ultimoMovimiento: now,
    },
  });
  await tx.stockPorDeposito.update({
    where: {
      productoId_depositoId: { productoId, depositoId: depositoDestinoId },
    },
    data: {
      cantidadFisica: { decrement: cantidad },
      ultimoMovimiento: now,
    },
  });
}

// ---------------------------------------------------------------
// Crear transferencia
// ---------------------------------------------------------------

export async function crearTransferenciaAction(
  raw: CrearTransferenciaInput,
): Promise<ActionResult<{ transferenciaId: string; numero: string }>> {
  if (!isStockDualEnabled()) return FLAG_OFF_ERROR;
  try {
    const input = parseTransferenciaInput(raw);
    const result = await db.$transaction(async (tx) => {
      await ensureProductoExiste(tx, input.productoId);
      await ensureDepositoActivoConId(tx, input.depositoOrigenId, "origen");
      await ensureDepositoActivoConId(tx, input.depositoDestinoId, "destino");
      await validarDisponible(tx, input.productoId, input.depositoOrigenId, input.cantidad);

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
    return {
      ok: true,
      data: { transferenciaId: result.id, numero: result.numero },
    };
  } catch (err) {
    if (err instanceof AsientoError) return { ok: false, error: err.message };
    return { ok: false, error: "Error al crear la transferencia." };
  }
}

// ---------------------------------------------------------------
// Anular transferencia
// ---------------------------------------------------------------

async function revertirTransferenciaConfirmada(
  tx: TxClient,
  t: {
    id: string;
    productoId: string;
    depositoOrigenId: string;
    depositoDestinoId: string;
    cantidad: number;
  },
): Promise<void> {
  await tx.movimientoStock.deleteMany({
    where: {
      transferenciaId: t.id,
      tipo: MovimientoStockTipo.TRANSFERENCIA,
    },
  });
  // Sentido inverso: origen recibe, destino devuelve.
  await moverCantidadFisica(tx, t.productoId, t.depositoOrigenId, t.depositoDestinoId, t.cantidad);
  await tx.transferencia.update({
    where: { id: t.id },
    data: { estado: TransferenciaEstado.ANULADA },
  });
}

export async function anularTransferenciaAction(transferenciaId: string): Promise<ActionResult> {
  if (!isStockDualEnabled()) return FLAG_OFF_ERROR;
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
      // S3.2: validar invariante 3 (disponible ≥ 0) en destino antes
      // del reverse — si entre crear y anular alguien consumió parte
      // del stock que llegó al destino, revertir la transferencia
      // dejaría cantidadFisica < cantidadReservada (negativo). Bloquear
      // con mensaje claro para que operador resuelva manualmente.
      try {
        await validarDisponible(tx, t.productoId, t.depositoDestinoId, t.cantidad);
      } catch (err) {
        if (err instanceof AsientoError) {
          throw new AsientoError(
            "DOMINIO_INVALIDO",
            `Stock destino insuficiente para revertir transferencia: ${err.message}`,
          );
        }
        throw err;
      }
      await revertirTransferenciaConfirmada(tx, t);
    });
    revalidatePath("/inventario");
    revalidatePath("/inventario/transferencias");
    return { ok: true, data: undefined };
  } catch (err) {
    if (err instanceof AsientoError) return { ok: false, error: err.message };
    return { ok: false, error: "Error al anular la transferencia." };
  }
}

// ---------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------

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
