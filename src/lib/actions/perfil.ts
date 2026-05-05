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

export async function actualizarMonedaPreferidaAction(
  raw: z.input<typeof monedaPreferidaSchema>,
): Promise<ActionResult<{ monedaPreferida: Moneda }>> {
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

  try {
    await db.user.update({
      where: { id: session.user.id },
      data: { monedaPreferida: parsed.data.monedaPreferida },
    });
    await unstable_update({
      user: { monedaPreferida: parsed.data.monedaPreferida },
    });
    revalidatePath("/perfil");
    revalidatePath("/reportes/balance-general");
    revalidatePath("/reportes/estado-resultados");
    return { ok: true, data: { monedaPreferida: parsed.data.monedaPreferida } };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { ok: false, error: "Usuario no encontrado." };
    }
    console.error("actualizarMonedaPreferidaAction failed", err);
    return { ok: false, error: "Error inesperado al guardar la preferencia." };
  }
}
