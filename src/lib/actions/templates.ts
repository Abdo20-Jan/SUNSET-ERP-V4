"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { requireCrmAuth } from "@/lib/actions/_crm-helpers";
import { Prisma } from "@/generated/prisma/client";

type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const templateSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio."),
  asunto: z.string().trim().min(1, "El asunto es obligatorio."),
  cuerpo: z.string().trim().min(1, "El cuerpo es obligatorio."),
  activo: z.boolean().optional().default(true),
});

export type TemplateInput = z.input<typeof templateSchema>;

type ParsedTemplate = z.output<typeof templateSchema>;

function parseTemplateInput(
  raw: TemplateInput,
): { ok: true; data: ParsedTemplate } | { ok: false; error: string } {
  const parsed = templateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  return { ok: true, data: parsed.data };
}

export async function listarTemplates() {
  return db.emailTemplate.findMany({ orderBy: { nombre: "asc" } });
}

export async function getTemplate(id: string) {
  return db.emailTemplate.findUnique({ where: { id } });
}

export async function crearTemplateAction(
  raw: TemplateInput,
): Promise<ActionResult<{ id: string }>> {
  const guard = await requireCrmAuth();
  if (!guard.ok) return guard;

  const validated = parseTemplateInput(raw);
  if (!validated.ok) return validated;

  try {
    const created = await db.emailTemplate.create({
      data: validated.data,
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
  const guard = await requireCrmAuth();
  if (!guard.ok) return guard;

  const validated = parseTemplateInput(raw);
  if (!validated.ok) return validated;

  try {
    const updated = await db.emailTemplate.update({
      where: { id },
      data: validated.data,
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
  const guard = await requireCrmAuth();
  if (!guard.ok) return guard;

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
