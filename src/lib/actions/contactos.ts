"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { requireCrmAuth } from "@/lib/actions/_crm-helpers";
import { Prisma } from "@/generated/prisma/client";

type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const nullableStr = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : null));

const contactoSchema = z
  .object({
    nombre: z.string().trim().min(1, "El nombre es obligatorio."),
    cargo: nullableStr,
    email: nullableStr.refine(
      (v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      "Email inválido.",
    ),
    telefono: nullableStr,
    esPrincipal: z.boolean().optional().default(false),
    leadId: nullableStr,
    clienteId: nullableStr,
  })
  .refine((v) => v.leadId !== null || v.clienteId !== null, {
    message: "Debe asociarse a un lead o un cliente.",
  });

export type ContactoInput = z.input<typeof contactoSchema>;

type ParsedContacto = z.output<typeof contactoSchema>;

function parseContactoInput(
  raw: ContactoInput,
): { ok: true; data: ParsedContacto } | { ok: false; error: string } {
  const parsed = contactoSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  return { ok: true, data: parsed.data };
}

export async function listarContactosDeLead(leadId: string) {
  return db.contacto.findMany({
    where: { leadId },
    orderBy: [{ esPrincipal: "desc" }, { nombre: "asc" }],
  });
}

export async function listarContactosDeCliente(clienteId: string) {
  return db.contacto.findMany({
    where: { clienteId },
    orderBy: [{ esPrincipal: "desc" }, { nombre: "asc" }],
  });
}

export async function crearContactoAction(
  raw: ContactoInput,
): Promise<ActionResult<{ id: string }>> {
  const guard = await requireCrmAuth();
  if (!guard.ok) return guard;

  const validated = parseContactoInput(raw);
  if (!validated.ok) return validated;

  try {
    const created = await db.$transaction(async (tx) => {
      if (validated.data.esPrincipal) {
        await desmarcarOtrosPrincipales(
          tx,
          validated.data.leadId,
          validated.data.clienteId,
        );
      }
      return tx.contacto.create({
        data: validated.data,
        select: { id: true, leadId: true, clienteId: true },
      });
    });
    revalidatePathsContacto(created.leadId, created.clienteId);
    return { ok: true, data: { id: created.id } };
  } catch (err) {
    console.error("crearContactoAction failed", err);
    return { ok: false, error: "Error inesperado al crear el contacto." };
  }
}

export async function editarContactoAction(
  id: string,
  raw: ContactoInput,
): Promise<ActionResult<{ id: string }>> {
  const guard = await requireCrmAuth();
  if (!guard.ok) return guard;
  if (!id) return { ok: false, error: "Id requerido." };

  const validated = parseContactoInput(raw);
  if (!validated.ok) return validated;

  try {
    const updated = await db.$transaction((tx) =>
      ejecutarUpdateContacto(tx, id, validated.data),
    );
    revalidatePathsContacto(updated.leadId, updated.clienteId);
    return { ok: true, data: { id: updated.id } };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { ok: false, error: "El contacto no existe." };
    }
    console.error("editarContactoAction failed", err);
    return { ok: false, error: "Error inesperado al actualizar el contacto." };
  }
}

async function ejecutarUpdateContacto(
  tx: Prisma.TransactionClient,
  id: string,
  data: ParsedContacto,
) {
  if (data.esPrincipal) {
    await desmarcarOtrosPrincipales(tx, data.leadId, data.clienteId, id);
  }
  return tx.contacto.update({
    where: { id },
    data,
    select: { id: true, leadId: true, clienteId: true },
  });
}

export async function marcarPrincipalAction(
  id: string,
): Promise<ActionResult<undefined>> {
  const guard = await requireCrmAuth();
  if (!guard.ok) return guard;

  try {
    await db.$transaction(async (tx) => {
      const contacto = await tx.contacto.findUnique({
        where: { id },
        select: { leadId: true, clienteId: true },
      });
      if (!contacto) throw new Error("CONTACTO_NOT_FOUND");
      await desmarcarOtrosPrincipales(tx, contacto.leadId, contacto.clienteId, id);
      await tx.contacto.update({ where: { id }, data: { esPrincipal: true } });
      revalidatePathsContacto(contacto.leadId, contacto.clienteId);
    });
    return { ok: true, data: undefined };
  } catch (err) {
    if (err instanceof Error && err.message === "CONTACTO_NOT_FOUND") {
      return { ok: false, error: "El contacto no existe." };
    }
    console.error("marcarPrincipalAction failed", err);
    return { ok: false, error: "Error inesperado al marcar como principal." };
  }
}

export async function eliminarContactoAction(
  id: string,
): Promise<ActionResult<undefined>> {
  const guard = await requireCrmAuth();
  if (!guard.ok) return guard;
  if (!id) return { ok: false, error: "Id requerido." };

  try {
    const c = await db.contacto.delete({
      where: { id },
      select: { leadId: true, clienteId: true },
    });
    revalidatePathsContacto(c.leadId, c.clienteId);
    return { ok: true, data: undefined };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { ok: false, error: "El contacto no existe." };
    }
    console.error("eliminarContactoAction failed", err);
    return { ok: false, error: "Error inesperado al eliminar el contacto." };
  }
}

async function desmarcarOtrosPrincipales(
  tx: Prisma.TransactionClient,
  leadId: string | null,
  clienteId: string | null,
  excludeId?: string,
) {
  const where: Prisma.ContactoWhereInput = { esPrincipal: true };
  if (leadId) where.leadId = leadId;
  else if (clienteId) where.clienteId = clienteId;
  if (excludeId) where.id = { not: excludeId };
  await tx.contacto.updateMany({ where, data: { esPrincipal: false } });
}

function revalidatePathsContacto(
  leadId: string | null,
  clienteId: string | null,
) {
  if (leadId) {
    revalidatePath(`/crm/leads/${leadId}`);
    revalidatePath("/crm/leads");
  }
  if (clienteId) {
    revalidatePath(`/maestros/clientes/${clienteId}`);
    revalidatePath("/crm/contactos");
  }
}
