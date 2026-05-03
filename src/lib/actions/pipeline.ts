"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isCrmEnabled } from "@/lib/features";
import { Prisma, Role } from "@/generated/prisma/client";

type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const FLAG_OFF_ERROR = {
  ok: false as const,
  error: "CRM no está habilitado (flag CRM_ENABLED=false).",
};

const NO_AUTH = { ok: false as const, error: "No autorizado." };
const NO_ADMIN = {
  ok: false as const,
  error: "Solo el administrador puede modificar el pipeline.",
};

const stageSchema = z.object({
  nombre: z.string().trim().min(1, "Nombre obligatorio."),
  esGanada: z.boolean().optional().default(false),
  esPerdida: z.boolean().optional().default(false),
  activo: z.boolean().optional().default(true),
});

export type StageInput = z.input<typeof stageSchema>;

export async function listarStages() {
  return db.pipelineStage.findMany({
    where: { activo: true },
    orderBy: { orden: "asc" },
    include: { _count: { select: { oportunidades: true } } },
  });
}

export async function crearStageAction(
  raw: StageInput,
): Promise<ActionResult<{ id: string }>> {
  if (!isCrmEnabled()) return FLAG_OFF_ERROR;
  const session = await auth();
  if (!session?.user.id) return NO_AUTH;
  if (session.user.role !== Role.ADMIN) return NO_ADMIN;

  const parsed = stageSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Datos inválidos." };
  }

  try {
    const created = await db.$transaction(async (tx) => {
      const last = await tx.pipelineStage.findFirst({
        orderBy: { orden: "desc" },
        select: { orden: true },
      });
      const nextOrden = (last?.orden ?? 0) + 1;
      return tx.pipelineStage.create({
        data: { ...parsed.data, orden: nextOrden },
        select: { id: true },
      });
    });
    revalidatePath("/crm/oportunidades/pipeline");
    return { ok: true, data: { id: created.id } };
  } catch (err) {
    console.error("crearStageAction failed", err);
    return { ok: false, error: "Error inesperado al crear stage." };
  }
}

export async function editarStageAction(
  id: string,
  raw: StageInput,
): Promise<ActionResult<{ id: string }>> {
  if (!isCrmEnabled()) return FLAG_OFF_ERROR;
  const session = await auth();
  if (!session?.user.id) return NO_AUTH;
  if (session.user.role !== Role.ADMIN) return NO_ADMIN;

  const parsed = stageSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Datos inválidos." };
  }

  try {
    const updated = await db.pipelineStage.update({
      where: { id },
      data: parsed.data,
      select: { id: true },
    });
    revalidatePath("/crm/oportunidades/pipeline");
    return { ok: true, data: { id: updated.id } };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { ok: false, error: "El stage no existe." };
    }
    console.error("editarStageAction failed", err);
    return { ok: false, error: "Error inesperado al actualizar stage." };
  }
}

export async function reordenarStagesAction(
  ordenIds: string[],
): Promise<ActionResult<undefined>> {
  if (!isCrmEnabled()) return FLAG_OFF_ERROR;
  const session = await auth();
  if (!session?.user.id) return NO_AUTH;
  if (session.user.role !== Role.ADMIN) return NO_ADMIN;
  if (!Array.isArray(ordenIds) || ordenIds.length === 0) {
    return { ok: false, error: "Lista de stages requerida." };
  }

  try {
    await db.$transaction(async (tx) => {
      const offset = 1000;
      for (let i = 0; i < ordenIds.length; i++) {
        await tx.pipelineStage.update({
          where: { id: ordenIds[i] },
          data: { orden: offset + i },
        });
      }
      for (let i = 0; i < ordenIds.length; i++) {
        await tx.pipelineStage.update({
          where: { id: ordenIds[i] },
          data: { orden: i + 1 },
        });
      }
    });
    revalidatePath("/crm/oportunidades/pipeline");
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("reordenarStagesAction failed", err);
    return { ok: false, error: "Error inesperado al reordenar stages." };
  }
}
