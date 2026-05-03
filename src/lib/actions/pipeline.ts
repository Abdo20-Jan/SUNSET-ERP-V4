"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { requireCrmAuth } from "@/lib/actions/_crm-helpers";
import { Prisma, Role } from "@/generated/prisma/client";
import { auth } from "@/lib/auth";

type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

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

type ParsedStage = z.output<typeof stageSchema>;

async function requireAdminCrm(): Promise<
  | { ok: true; userId: string }
  | { ok: false; error: string }
> {
  const guard = await requireCrmAuth();
  if (!guard.ok) return guard;
  const session = await auth();
  if (session?.user.role !== Role.ADMIN) return NO_ADMIN;
  return guard;
}

function parseStageInput(
  raw: StageInput,
): { ok: true; data: ParsedStage } | { ok: false; error: string } {
  const parsed = stageSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  return { ok: true, data: parsed.data };
}

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
  const guard = await requireAdminCrm();
  if (!guard.ok) return guard;

  const validated = parseStageInput(raw);
  if (!validated.ok) return validated;

  try {
    const created = await db.$transaction(async (tx) => {
      const last = await tx.pipelineStage.findFirst({
        orderBy: { orden: "desc" },
        select: { orden: true },
      });
      const nextOrden = (last?.orden ?? 0) + 1;
      return tx.pipelineStage.create({
        data: { ...validated.data, orden: nextOrden },
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
  const guard = await requireAdminCrm();
  if (!guard.ok) return guard;

  const validated = parseStageInput(raw);
  if (!validated.ok) return validated;

  try {
    const updated = await db.pipelineStage.update({
      where: { id },
      data: validated.data,
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
  const guard = await requireAdminCrm();
  if (!guard.ok) return guard;
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
