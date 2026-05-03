"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { requireCrmAuth } from "@/lib/actions/_crm-helpers";
import { ActividadTipo, Prisma } from "@/generated/prisma/client";

type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const optionalStr = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : null));

const actividadSchema = z
  .object({
    tipo: z.nativeEnum(ActividadTipo),
    contenido: z.string().trim().min(1, "El contenido es obligatorio."),
    fechaProgramada: z.coerce.date().optional().nullable(),
    leadId: optionalStr,
    clienteId: optionalStr,
    oportunidadId: optionalStr,
  })
  .refine(
    (v) => v.leadId !== null || v.clienteId !== null || v.oportunidadId !== null,
    { message: "Debe asociarse a un lead, cliente u oportunidad." },
  );

export type ActividadInput = z.input<typeof actividadSchema>;

type ParsedActividad = z.output<typeof actividadSchema>;

function parseActividadInput(
  raw: ActividadInput,
): { ok: true; data: ParsedActividad } | { ok: false; error: string } {
  const parsed = actividadSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  return { ok: true, data: parsed.data };
}

function buildActividadData(parsed: ParsedActividad) {
  return {
    tipo: parsed.tipo,
    contenido: parsed.contenido,
    fechaProgramada: parsed.fechaProgramada ?? null,
    leadId: parsed.leadId,
    clienteId: parsed.clienteId,
    oportunidadId: parsed.oportunidadId,
  };
}

export async function listarActividadesPendientes(ownerId: string) {
  return db.actividad.findMany({
    where: { ownerId, completada: false },
    orderBy: [{ fechaProgramada: "asc" }, { createdAt: "desc" }],
    include: {
      lead: { select: { id: true, nombre: true, empresa: true } },
      cliente: { select: { id: true, nombre: true } },
      oportunidad: { select: { id: true, numero: true, titulo: true } },
    },
  });
}

export async function listarActividadesDeLead(leadId: string) {
  return db.actividad.findMany({
    where: { leadId },
    orderBy: [{ completada: "asc" }, { fechaProgramada: "asc" }, { createdAt: "desc" }],
    include: { owner: { select: { nombre: true } } },
  });
}

export async function listarActividadesDeOportunidad(oportunidadId: string) {
  return db.actividad.findMany({
    where: { oportunidadId },
    orderBy: [{ completada: "asc" }, { fechaProgramada: "asc" }, { createdAt: "desc" }],
    include: { owner: { select: { nombre: true } } },
  });
}

export async function crearActividadAction(
  raw: ActividadInput,
): Promise<ActionResult<{ id: string }>> {
  const guard = await requireCrmAuth();
  if (!guard.ok) return guard;

  const validated = parseActividadInput(raw);
  if (!validated.ok) return validated;

  try {
    const created = await db.actividad.create({
      data: { ...buildActividadData(validated.data), ownerId: guard.userId },
      select: { id: true, leadId: true, clienteId: true, oportunidadId: true },
    });
    revalidatePathsActividad(created.leadId, created.clienteId, created.oportunidadId);
    return { ok: true, data: { id: created.id } };
  } catch (err) {
    console.error("crearActividadAction failed", err);
    return { ok: false, error: "Error inesperado al crear la actividad." };
  }
}

export async function editarActividadAction(
  id: string,
  raw: ActividadInput,
): Promise<ActionResult<{ id: string }>> {
  const guard = await requireCrmAuth();
  if (!guard.ok) return guard;
  if (!id) return { ok: false, error: "Id requerido." };

  const validated = parseActividadInput(raw);
  if (!validated.ok) return validated;

  try {
    const updated = await db.actividad.update({
      where: { id },
      data: buildActividadData(validated.data),
      select: { id: true, leadId: true, clienteId: true, oportunidadId: true },
    });
    revalidatePathsActividad(updated.leadId, updated.clienteId, updated.oportunidadId);
    return { ok: true, data: { id: updated.id } };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { ok: false, error: "La actividad no existe." };
    }
    console.error("editarActividadAction failed", err);
    return { ok: false, error: "Error inesperado al actualizar la actividad." };
  }
}

export async function completarActividadAction(
  id: string,
): Promise<ActionResult<undefined>> {
  const guard = await requireCrmAuth();
  if (!guard.ok) return guard;
  if (!id) return { ok: false, error: "Id requerido." };

  try {
    const updated = await db.actividad.update({
      where: { id },
      data: { completada: true, fechaCompletada: new Date() },
      select: { leadId: true, clienteId: true, oportunidadId: true },
    });
    revalidatePathsActividad(updated.leadId, updated.clienteId, updated.oportunidadId);
    revalidatePath("/crm/actividades");
    return { ok: true, data: undefined };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { ok: false, error: "La actividad no existe." };
    }
    console.error("completarActividadAction failed", err);
    return { ok: false, error: "Error inesperado al completar la actividad." };
  }
}

export async function eliminarActividadAction(
  id: string,
): Promise<ActionResult<undefined>> {
  const guard = await requireCrmAuth();
  if (!guard.ok) return guard;
  if (!id) return { ok: false, error: "Id requerido." };

  try {
    const a = await db.actividad.delete({
      where: { id },
      select: { leadId: true, clienteId: true, oportunidadId: true },
    });
    revalidatePathsActividad(a.leadId, a.clienteId, a.oportunidadId);
    return { ok: true, data: undefined };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { ok: false, error: "La actividad no existe." };
    }
    console.error("eliminarActividadAction failed", err);
    return { ok: false, error: "Error inesperado al eliminar la actividad." };
  }
}

function revalidatePathsActividad(
  leadId: string | null,
  clienteId: string | null,
  oportunidadId: string | null,
) {
  revalidatePath("/crm/actividades");
  if (leadId) revalidatePath(`/crm/leads/${leadId}`);
  if (clienteId) revalidatePath(`/maestros/clientes/${clienteId}`);
  if (oportunidadId) revalidatePath(`/crm/oportunidades/${oportunidadId}`);
}
