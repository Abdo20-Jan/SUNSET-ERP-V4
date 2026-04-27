"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const fechaSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD)");

const valorSchema = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, "Valor inválido")
  .refine((v) => Number(v) > 0, "Valor debe ser > 0");

const upsertSchema = z.object({
  fecha: fechaSchema,
  valor: valorSchema,
  fuente: z.string().max(40).optional(),
});

export type UpsertCotizacionResult =
  | { ok: true }
  | { ok: false; error: string };

export async function upsertCotizacionAction(
  input: z.infer<typeof upsertSchema>,
): Promise<UpsertCotizacionResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autenticado" };

  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Inválido" };
  }

  const fechaUtc = new Date(parsed.data.fecha + "T00:00:00.000Z");

  await db.cotizacion.upsert({
    where: { fecha: fechaUtc },
    create: {
      fecha: fechaUtc,
      valor: parsed.data.valor,
      fuente: parsed.data.fuente?.trim() || null,
    },
    update: {
      valor: parsed.data.valor,
      fuente: parsed.data.fuente?.trim() || null,
    },
  });

  revalidatePath("/maestros/cotizaciones");
  revalidatePath("/reportes/balance-general");
  revalidatePath("/reportes/estado-resultados");
  revalidatePath("/reportes/flujo-caja");
  revalidatePath("/reportes/libro-diario");
  revalidatePath("/reportes/libro-mayor");

  return { ok: true };
}

export async function deleteCotizacionAction(
  id: number,
): Promise<UpsertCotizacionResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autenticado" };

  await db.cotizacion.delete({ where: { id } });

  revalidatePath("/maestros/cotizaciones");
  return { ok: true };
}
