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
  if (!isCrmEnabled()) return FLAG_OFF_ERROR;
  const session = await auth();
  if (!session?.user.id) return NO_AUTH;

  const parsed = contactoSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Datos inválidos." };
  }

  try {
    const created = await db.$transaction(async (tx) => {
      if (parsed.data.esPrincipal) {
        await desmarcarOtrosPrincipales(tx, parsed.data.leadId, parsed.data.clienteId);
      }
      return tx.contacto.create({
        data: parsed.data,
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
  if (!isCrmEnabled()) return FLAG_OFF_ERROR;
  const session = await auth();
  if (!session?.user.id) return NO_AUTH;
  if (!id) return { ok: false, error: "Id requerido." };

  const parsed = contactoSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Datos inválidos." };
  }

  try {
    const updated = await db.$transaction(async (tx) => {
      if (parsed.data.esPrincipal) {
        await desmarcarOtrosPrincipales(
          tx,
          parsed.data.leadId,
          parsed.data.clienteId,
          id,
        );
      }
      return tx.contacto.update({
        where: { id },
        data: parsed.data,
        select: { id: true, leadId: true, clienteId: true },
      });
    });
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

export async function marcarPrincipalAction(
  id: string,
): Promise<ActionResult<undefined>> {
  if (!isCrmEnabled()) return FLAG_OFF_ERROR;
  const session = await auth();
  if (!session?.user.id) return NO_AUTH;

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
  if (!isCrmEnabled()) return FLAG_OFF_ERROR;
  const session = await auth();
  if (!session?.user.id) return NO_AUTH;
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
