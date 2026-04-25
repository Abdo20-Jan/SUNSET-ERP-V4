"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";

export type DepositoRow = {
  id: string;
  nombre: string;
  direccion: string | null;
  activo: boolean;
};

export async function listarDepositos(): Promise<DepositoRow[]> {
  const rows = await db.deposito.findMany({
    orderBy: { nombre: "asc" },
    select: {
      id: true,
      nombre: true,
      direccion: true,
      activo: true,
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
});

export type DepositoInput = z.input<typeof depositoSchema>;

export type DepositoActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function crearDepositoAction(
  raw: DepositoInput,
): Promise<DepositoActionResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado." };

  const parsed = depositoSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Datos inválidos." };
  }

  try {
    const created = await db.deposito.create({
      data: parsed.data,
      select: { id: true },
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
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado." };
  if (!id) return { ok: false, error: "Id requerido." };

  const parsed = depositoSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Datos inválidos." };
  }

  try {
    const updated = await db.deposito.update({
      where: { id },
      data: parsed.data,
      select: { id: true },
    });
    revalidatePath("/maestros/depositos");
    revalidatePath("/maestros");
    return { ok: true, id: updated.id };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2025"
    ) {
      return { ok: false, error: "El depósito no existe." };
    }
    console.error("actualizarDepositoAction failed", err);
    return { ok: false, error: "Error inesperado al actualizar el depósito." };
  }
}

export async function eliminarDepositoAction(
  id: string,
): Promise<{ ok: true; softDeleted: boolean } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado." };
  if (!id) return { ok: false, error: "Id requerido." };

  const [stockCount, embarquesCount] = await Promise.all([
    db.movimientoStock.count({ where: { depositoId: id } }),
    db.embarque.count({ where: { depositoDestinoId: id } }),
  ]);

  const tieneReferencias = stockCount > 0 || embarquesCount > 0;

  try {
    if (tieneReferencias) {
      await db.deposito.update({
        where: { id },
        data: { activo: false },
        select: { id: true },
      });
      revalidatePath("/maestros/depositos");
      revalidatePath("/maestros");
      return { ok: true, softDeleted: true };
    }
    await db.deposito.delete({ where: { id } });
    revalidatePath("/maestros/depositos");
    revalidatePath("/maestros");
    return { ok: true, softDeleted: false };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2025"
    ) {
      return { ok: false, error: "El depósito no existe." };
    }
    console.error("eliminarDepositoAction failed", err);
    return { ok: false, error: "Error inesperado al eliminar el depósito." };
  }
}
