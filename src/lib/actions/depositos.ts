"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireSessionUser } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { registrarAuditoria } from "@/lib/services/auditoria";
import { Prisma, TipoDeposito } from "@/generated/prisma/client";

export type DepositoRow = {
  id: string;
  nombre: string;
  direccion: string | null;
  activo: boolean;
  tipo: TipoDeposito;
};

export async function listarDepositos(): Promise<DepositoRow[]> {
  const rows = await db.deposito.findMany({
    orderBy: { nombre: "asc" },
    select: {
      id: true,
      nombre: true,
      direccion: true,
      activo: true,
      tipo: true,
    },
  });
  return rows;
}

const nullableStr = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : null));

const depositoSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio."),
  direccion: nullableStr,
  activo: z.boolean().optional().default(true),
  tipo: z.nativeEnum(TipoDeposito).optional().default(TipoDeposito.NACIONAL),
});

export type DepositoInput = z.input<typeof depositoSchema>;

export type DepositoActionResult = { ok: true; id: string } | { ok: false; error: string };

// Campos JSON-safe del depósito que se versionan en la auditoría (todos
// scalars, sin Decimal ni Date). NO exportar (archivo "use server").
const SNAPSHOT_DEPOSITO = {
  nombre: true,
  direccion: true,
  activo: true,
  tipo: true,
  subtipo: true,
  jurisdiccion: true,
  esDeTerceros: true,
  depositarioRazonSocial: true,
  depositarioCuit: true,
} as const;

export async function crearDepositoAction(raw: DepositoInput): Promise<DepositoActionResult> {
  const usuarioId = await requireSessionUser();

  const parsed = depositoSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Datos inválidos." };
  }

  try {
    const created = await db.$transaction(async (tx) => {
      const { id, ...snapshot } = await tx.deposito.create({
        data: parsed.data,
        select: { id: true, ...SNAPSHOT_DEPOSITO },
      });
      await registrarAuditoria(tx, {
        tabla: "Deposito",
        registroId: id,
        accion: "CREATE",
        usuarioId,
        datosNuevos: snapshot,
      });
      return { id };
    });
    revalidatePath("/maestros/depositos");
    revalidatePath("/maestros");
    return { ok: true, id: created.id };
  } catch (err) {
    console.error("crearDepositoAction failed", err);
    return { ok: false, error: "Error inesperado al crear el depósito." };
  }
}

export async function actualizarDepositoAction(
  id: string,
  raw: DepositoInput,
): Promise<DepositoActionResult> {
  const usuarioId = await requireSessionUser();
  if (!id) return { ok: false, error: "Id requerido." };

  const parsed = depositoSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Datos inválidos." };
  }

  try {
    const updated = await db.$transaction(async (tx) => {
      const antes = await tx.deposito.findUnique({ where: { id }, select: SNAPSHOT_DEPOSITO });
      if (!antes)
        throw new Prisma.PrismaClientKnownRequestError("No existe", {
          code: "P2025",
          clientVersion: "",
        });
      const { id: updatedId, ...despues } = await tx.deposito.update({
        where: { id },
        data: parsed.data,
        select: { id: true, ...SNAPSHOT_DEPOSITO },
      });
      await registrarAuditoria(tx, {
        tabla: "Deposito",
        registroId: updatedId,
        accion: "UPDATE",
        usuarioId,
        datosAnteriores: antes,
        datosNuevos: despues,
      });
      return { id: updatedId };
    });
    revalidatePath("/maestros/depositos");
    revalidatePath("/maestros");
    return { ok: true, id: updated.id };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { ok: false, error: "El depósito no existe." };
    }
    console.error("actualizarDepositoAction failed", err);
    return { ok: false, error: "Error inesperado al actualizar el depósito." };
  }
}

export async function eliminarDepositoAction(
  id: string,
): Promise<{ ok: true; softDeleted: boolean } | { ok: false; error: string }> {
  const usuarioId = await requireSessionUser();
  if (!id) return { ok: false, error: "Id requerido." };

  try {
    const { softDeleted } = await db.$transaction(async (tx) => {
      const antes = await tx.deposito.findUnique({ where: { id }, select: SNAPSHOT_DEPOSITO });
      if (!antes)
        throw new Prisma.PrismaClientKnownRequestError("No existe", {
          code: "P2025",
          clientVersion: "",
        });

      const [stockCount, embarquesCount] = await Promise.all([
        tx.movimientoStock.count({ where: { depositoId: id } }),
        tx.embarque.count({ where: { depositoDestinoId: id } }),
      ]);

      if (stockCount > 0 || embarquesCount > 0) {
        await tx.deposito.update({ where: { id }, data: { activo: false }, select: { id: true } });
        await registrarAuditoria(tx, {
          tabla: "Deposito",
          registroId: id,
          accion: "UPDATE",
          usuarioId,
          datosAnteriores: antes,
          datosNuevos: { ...antes, activo: false },
        });
        return { softDeleted: true };
      }

      await registrarAuditoria(tx, {
        tabla: "Deposito",
        registroId: id,
        accion: "DELETE",
        usuarioId,
        datosAnteriores: antes,
      });
      await tx.deposito.delete({ where: { id } });
      return { softDeleted: false };
    });
    revalidatePath("/maestros/depositos");
    revalidatePath("/maestros");
    return { ok: true, softDeleted };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { ok: false, error: "El depósito no existe." };
    }
    console.error("eliminarDepositoAction failed", err);
    return { ok: false, error: "Error inesperado al eliminar el depósito." };
  }
}
