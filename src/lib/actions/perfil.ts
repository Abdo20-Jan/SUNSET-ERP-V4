"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth, unstable_update } from "@/lib/auth";
import { db } from "@/lib/db";
import { Moneda, Prisma } from "@/generated/prisma/client";

type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const monedaPreferidaSchema = z.object({
  monedaPreferida: z.nativeEnum(Moneda),
});

type ParsedMonedaPreferida = z.output<typeof monedaPreferidaSchema>;

async function validarPerfilUpdate(
  raw: z.input<typeof monedaPreferidaSchema>,
): Promise<
  { ok: true; userId: string; data: ParsedMonedaPreferida } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user.id) {
    return { ok: false, error: "No autorizado." };
  }
  const parsed = monedaPreferidaSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  return { ok: true, userId: session.user.id, data: parsed.data };
}

function revalidarPerfilYReportes() {
  revalidatePath("/perfil");
  revalidatePath("/reportes/balance-general");
  revalidatePath("/reportes/estado-resultados");
}

export async function actualizarMonedaPreferidaAction(
  raw: z.input<typeof monedaPreferidaSchema>,
): Promise<ActionResult<{ monedaPreferida: Moneda }>> {
  const guard = await validarPerfilUpdate(raw);
  if (!guard.ok) return guard;

  try {
    await db.user.update({
      where: { id: guard.userId },
      data: { monedaPreferida: guard.data.monedaPreferida },
    });
    await unstable_update({
      user: { monedaPreferida: guard.data.monedaPreferida },
    });
    revalidarPerfilYReportes();
    return { ok: true, data: { monedaPreferida: guard.data.monedaPreferida } };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { ok: false, error: "Usuario no encontrado." };
    }
    console.error("actualizarMonedaPreferidaAction failed", err);
    return { ok: false, error: "Error inesperado al guardar la preferencia." };
  }
}

const modoRetroactivoSchema = z.object({
  modoRetroactivo: z.boolean(),
});

function isPrismaUserNotFound(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025"
  );
}

function firstZodMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Datos inválidos.";
}

export async function actualizarModoRetroactivoAction(
  raw: z.input<typeof modoRetroactivoSchema>,
): Promise<ActionResult<{ modoRetroactivo: boolean }>> {
  const session = await auth();
  if (!session?.user.id) {
    return { ok: false, error: "No autorizado." };
  }
  const parsed = modoRetroactivoSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: firstZodMessage(parsed.error) };
  }
  try {
    await db.user.update({
      where: { id: session.user.id },
      data: { modoRetroactivo: parsed.data.modoRetroactivo },
    });
    await unstable_update({
      user: { modoRetroactivo: parsed.data.modoRetroactivo },
    });
    revalidatePath("/perfil");
    revalidatePath("/", "layout");
    return { ok: true, data: { modoRetroactivo: parsed.data.modoRetroactivo } };
  } catch (err) {
    if (isPrismaUserNotFound(err)) {
      return { ok: false, error: "Usuario no encontrado." };
    }
    console.error("actualizarModoRetroactivoAction failed", err);
    return { ok: false, error: "Error inesperado al guardar la preferencia." };
  }
}
