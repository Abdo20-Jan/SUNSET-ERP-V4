"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isCrmEnabled } from "@/lib/features";
import { Prisma } from "@/generated/prisma/client";

type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const FLAG_OFF_ERROR = {
  ok: false as const,
  error: "CRM no está habilitado (flag CRM_ENABLED=false).",
};

const NO_AUTH = { ok: false as const, error: "No autorizado." };

const templateSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio."),
  asunto: z.string().trim().min(1, "El asunto es obligatorio."),
  cuerpo: z.string().trim().min(1, "El cuerpo es obligatorio."),
  activo: z.boolean().optional().default(true),
});

export type TemplateInput = z.input<typeof templateSchema>;

export async function listarTemplates() {
  return db.emailTemplate.findMany({ orderBy: { nombre: "asc" } });
}

export async function getTemplate(id: string) {
  return db.emailTemplate.findUnique({ where: { id } });
}

export async function crearTemplateAction(
  raw: TemplateInput,
): Promise<ActionResult<{ id: string }>> {
  if (!isCrmEnabled()) return FLAG_OFF_ERROR;
  const session = await auth();
  if (!session?.user.id) return NO_AUTH;

  const parsed = templateSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Datos inválidos." };
  }

  try {
    const created = await db.emailTemplate.create({
      data: parsed.data,
      select: { id: true },
    });
    revalidatePath("/crm/configuracion/templates");
    return { ok: true, data: { id: created.id } };
  } catch (err) {
    console.error("crearTemplateAction failed", err);
    return { ok: false, error: "Error inesperado al crear el template." };
  }
}

export async function editarTemplateAction(
  id: string,
  raw: TemplateInput,
): Promise<ActionResult<{ id: string }>> {
  if (!isCrmEnabled()) return FLAG_OFF_ERROR;
  const session = await auth();
  if (!session?.user.id) return NO_AUTH;

  const parsed = templateSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Datos inválidos." };
  }

  try {
    const updated = await db.emailTemplate.update({
      where: { id },
      data: parsed.data,
      select: { id: true },
    });
    revalidatePath("/crm/configuracion/templates");
    return { ok: true, data: { id: updated.id } };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { ok: false, error: "El template no existe." };
    }
    console.error("editarTemplateAction failed", err);
    return { ok: false, error: "Error inesperado al actualizar el template." };
  }
}

export async function eliminarTemplateAction(
  id: string,
): Promise<ActionResult<undefined>> {
  if (!isCrmEnabled()) return FLAG_OFF_ERROR;
  const session = await auth();
  if (!session?.user.id) return NO_AUTH;

  try {
    await db.emailTemplate.delete({ where: { id } });
    revalidatePath("/crm/configuracion/templates");
    return { ok: true, data: undefined };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { ok: false, error: "El template no existe." };
    }
    console.error("eliminarTemplateAction failed", err);
    return { ok: false, error: "Error inesperado al eliminar el template." };
  }
}
