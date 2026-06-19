"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth-guard";
import { coerceViewConfig, type SavedViewConfig } from "@/lib/saved-views";

export type VistaGuardada = {
  id: string;
  nombre: string;
  esPredeterminada: boolean;
  config: SavedViewConfig;
};

type ActionResult = { ok: true } | { ok: false; error: string };

// Vistas del usuario actual para una ruta de lista. La predeterminada primero.
export async function listarVistas(ruta: string): Promise<VistaGuardada[]> {
  const userId = await requireSessionUser();
  const rows = await db.savedView.findMany({
    where: { userId, ruta },
    orderBy: [{ esPredeterminada: "desc" }, { nombre: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    nombre: row.nombre,
    esPredeterminada: row.esPredeterminada,
    config: coerceViewConfig(row.config),
  }));
}

// Crea o actualiza (mismo nombre en la ruta) una vista. Si se marca como
// predeterminada, desmarca las demás de esa ruta dentro de una transacción.
export async function guardarVista(input: {
  ruta: string;
  nombre: string;
  config: SavedViewConfig;
  esPredeterminada: boolean;
}): Promise<ActionResult> {
  const userId = await requireSessionUser();
  const nombre = input.nombre.trim();
  if (!nombre) return { ok: false, error: "El nombre es obligatorio." };

  const config = coerceViewConfig(input.config);

  await db.$transaction(async (tx) => {
    if (input.esPredeterminada) {
      await tx.savedView.updateMany({
        where: { userId, ruta: input.ruta, esPredeterminada: true },
        data: { esPredeterminada: false },
      });
    }
    await tx.savedView.upsert({
      where: { userId_ruta_nombre: { userId, ruta: input.ruta, nombre } },
      create: {
        userId,
        ruta: input.ruta,
        nombre,
        config,
        esPredeterminada: input.esPredeterminada,
      },
      update: { config, esPredeterminada: input.esPredeterminada },
    });
  });

  revalidatePath(input.ruta);
  return { ok: true };
}

// Borra una vista del usuario actual (scoped: deleteMany por id + userId).
export async function eliminarVista(id: string): Promise<ActionResult> {
  const userId = await requireSessionUser();
  const vista = await db.savedView.findFirst({ where: { id, userId }, select: { ruta: true } });
  if (!vista) return { ok: false, error: "Vista no encontrada." };
  await db.savedView.delete({ where: { id } });
  revalidatePath(vista.ruta);
  return { ok: true };
}

// Marca/desmarca una vista como predeterminada. Al marcar, desmarca las demás
// de la misma ruta en una transacción (a lo sumo una predeterminada por ruta).
export async function definirPredeterminada(id: string, valor: boolean): Promise<ActionResult> {
  const userId = await requireSessionUser();
  const vista = await db.savedView.findFirst({ where: { id, userId } });
  if (!vista) return { ok: false, error: "Vista no encontrada." };

  await db.$transaction(async (tx) => {
    if (valor) {
      await tx.savedView.updateMany({
        where: { userId, ruta: vista.ruta, esPredeterminada: true },
        data: { esPredeterminada: false },
      });
    }
    await tx.savedView.update({ where: { id }, data: { esPredeterminada: valor } });
  });

  revalidatePath(vista.ruta);
  return { ok: true };
}
