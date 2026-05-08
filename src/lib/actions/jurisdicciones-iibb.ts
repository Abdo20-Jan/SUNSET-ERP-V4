"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export type JurisdiccionIIBBRow = {
  id: number;
  codigo: string;
  nombre: string;
  alicuotaPercepcion: string;
  esAgentePercepcion: boolean;
  provinciaId: number | null;
};

export async function listarJurisdiccionesIIBB(): Promise<JurisdiccionIIBBRow[]> {
  const rows = await db.jurisdiccionIIBB.findMany({
    orderBy: { nombre: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    codigo: r.codigo,
    nombre: r.nombre,
    alicuotaPercepcion: r.alicuotaPercepcion.toString(),
    esAgentePercepcion: r.esAgentePercepcion,
    provinciaId: r.provinciaId,
  }));
}

const updateSchema = z.object({
  id: z.number().int().positive(),
  alicuotaPercepcion: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, "Alícuota inválida (formato 0.0000-99.9999)")
    .refine((v) => Number(v) >= 0 && Number(v) <= 100, "Alícuota fuera de rango [0, 100]"),
  esAgentePercepcion: z.boolean(),
});

export async function actualizarJurisdiccionIIBBAction(
  input: z.infer<typeof updateSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autenticado" };

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Inválido" };
  }

  try {
    await db.jurisdiccionIIBB.update({
      where: { id: parsed.data.id },
      data: {
        alicuotaPercepcion: parsed.data.alicuotaPercepcion,
        esAgentePercepcion: parsed.data.esAgentePercepcion,
      },
    });
    revalidatePath("/maestros/jurisdicciones-iibb");
    return { ok: true };
  } catch {
    return { ok: false, error: "Error al actualizar la jurisdicción" };
  }
}
