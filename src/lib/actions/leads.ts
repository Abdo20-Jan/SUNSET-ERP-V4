"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isCrmEnabled } from "@/lib/features";
import {
  CondicionIva,
  LeadEstado,
  LeadFuente,
  OportunidadEstado,
  Prisma,
  TipoCanal,
} from "@/generated/prisma/client";

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

const leadSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio."),
  empresa: nullableStr,
  cuit: nullableStr,
  email: nullableStr.refine(
    (v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    "Email inválido.",
  ),
  telefono: nullableStr,
  fuente: z.nativeEnum(LeadFuente).default(LeadFuente.ORGANICO),
  estado: z.nativeEnum(LeadEstado).default(LeadEstado.NUEVO),
  notas: nullableStr,
});

export type LeadInput = z.input<typeof leadSchema>;

export type LeadRow = {
  id: string;
  nombre: string;
  empresa: string | null;
  cuit: string | null;
  email: string | null;
  telefono: string | null;
  fuente: LeadFuente;
  estado: LeadEstado;
  score: number;
  ownerId: string;
  ownerNombre: string;
  clienteId: string | null;
  clienteNombre: string | null;
  notas: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function listarLeads(filtros?: {
  estado?: LeadEstado;
  ownerId?: string;
  fuente?: LeadFuente;
  search?: string;
}): Promise<LeadRow[]> {
  const where: Prisma.LeadWhereInput = {};
  if (filtros?.estado) where.estado = filtros.estado;
  if (filtros?.ownerId) where.ownerId = filtros.ownerId;
  if (filtros?.fuente) where.fuente = filtros.fuente;
  if (filtros?.search) {
    const q = filtros.search.trim();
    if (q.length > 0) {
      where.OR = [
        { nombre: { contains: q, mode: "insensitive" } },
        { empresa: { contains: q, mode: "insensitive" } },
        { cuit: { contains: q } },
        { email: { contains: q, mode: "insensitive" } },
      ];
    }
  }

  const rows = await db.lead.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      owner: { select: { nombre: true } },
      cliente: { select: { nombre: true } },
    },
  });

  return rows.map((l) => ({
    id: l.id,
    nombre: l.nombre,
    empresa: l.empresa,
    cuit: l.cuit,
    email: l.email,
    telefono: l.telefono,
    fuente: l.fuente,
    estado: l.estado,
    score: l.score,
    ownerId: l.ownerId,
    ownerNombre: l.owner.nombre,
    clienteId: l.clienteId,
    clienteNombre: l.cliente?.nombre ?? null,
    notas: l.notas,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  }));
}

export async function getLead(id: string) {
  return db.lead.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, nombre: true } },
      cliente: { select: { id: true, nombre: true, cuit: true } },
      contactos: { orderBy: [{ esPrincipal: "desc" }, { nombre: "asc" }] },
      actividades: {
        orderBy: [{ completada: "asc" }, { fechaProgramada: "asc" }, { createdAt: "desc" }],
        include: { owner: { select: { nombre: true } } },
      },
      oportunidades: {
        include: { stage: { select: { nombre: true, esGanada: true, esPerdida: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

export async function crearLeadAction(
  raw: LeadInput,
): Promise<ActionResult<{ id: string }>> {
  if (!isCrmEnabled()) return FLAG_OFF_ERROR;
  const session = await auth();
  if (!session?.user.id) return NO_AUTH;

  const parsed = leadSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Datos inválidos." };
  }

  try {
    const created = await db.lead.create({
      data: { ...parsed.data, ownerId: session.user.id },
      select: { id: true },
    });
    revalidatePath("/crm/leads");
    revalidatePath("/crm");
    return { ok: true, data: { id: created.id } };
  } catch (err) {
    console.error("crearLeadAction failed", err);
    return { ok: false, error: "Error inesperado al crear el lead." };
  }
}

export async function editarLeadAction(
  id: string,
  raw: LeadInput,
): Promise<ActionResult<{ id: string }>> {
  if (!isCrmEnabled()) return FLAG_OFF_ERROR;
  const session = await auth();
  if (!session?.user.id) return NO_AUTH;
  if (!id) return { ok: false, error: "Id requerido." };

  const parsed = leadSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Datos inválidos." };
  }

  try {
    const updated = await db.lead.update({
      where: { id },
      data: parsed.data,
      select: { id: true },
    });
    revalidatePath("/crm/leads");
    revalidatePath(`/crm/leads/${id}`);
    return { ok: true, data: { id: updated.id } };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { ok: false, error: "El lead no existe." };
    }
    console.error("editarLeadAction failed", err);
    return { ok: false, error: "Error inesperado al actualizar el lead." };
  }
}

export async function eliminarLeadAction(
  id: string,
): Promise<ActionResult<undefined>> {
  if (!isCrmEnabled()) return FLAG_OFF_ERROR;
  const session = await auth();
  if (!session?.user.id) return NO_AUTH;
  if (!id) return { ok: false, error: "Id requerido." };

  try {
    await db.lead.delete({ where: { id } });
    revalidatePath("/crm/leads");
    return { ok: true, data: undefined };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { ok: false, error: "El lead no existe." };
    }
    console.error("eliminarLeadAction failed", err);
    return { ok: false, error: "Error inesperado al eliminar el lead." };
  }
}

export async function convertirLeadEnClienteAction(
  leadId: string,
): Promise<ActionResult<{ clienteId: string; oportunidadesActualizadas: number }>> {
  if (!isCrmEnabled()) return FLAG_OFF_ERROR;
  const session = await auth();
  if (!session?.user.id) return NO_AUTH;

  try {
    const result = await db.$transaction(async (tx) => {
      const lead = await tx.lead.findUnique({
        where: { id: leadId },
        include: { contactos: true },
      });
      if (!lead) throw new Error("LEAD_NOT_FOUND");
      if (lead.clienteId) throw new Error("LEAD_YA_CONVERTIDO");

      let clienteId: string;
      if (lead.cuit) {
        const existente = await tx.cliente.findUnique({
          where: { cuit: lead.cuit },
          select: { id: true },
        });
        if (existente) {
          clienteId = existente.id;
        } else {
          const nuevo = await tx.cliente.create({
            data: {
              nombre: lead.empresa ?? lead.nombre,
              cuit: lead.cuit,
              email: lead.email,
              telefono: lead.telefono,
              tipoCanal: TipoCanal.MINORISTA,
              condicionIva: CondicionIva.RI,
            },
            select: { id: true },
          });
          clienteId = nuevo.id;
        }
      } else {
        const nuevo = await tx.cliente.create({
          data: {
            nombre: lead.empresa ?? lead.nombre,
            email: lead.email,
            telefono: lead.telefono,
            tipoCanal: TipoCanal.MINORISTA,
            condicionIva: CondicionIva.RI,
          },
          select: { id: true },
        });
        clienteId = nuevo.id;
      }

      await tx.lead.update({
        where: { id: leadId },
        data: { clienteId, estado: LeadEstado.CONVERTIDO },
      });

      if (lead.contactos.length > 0) {
        await tx.contacto.updateMany({
          where: { leadId, clienteId: null },
          data: { clienteId },
        });
      }

      const opsActualizadas = await tx.oportunidad.updateMany({
        where: { leadId, clienteId: null, estado: OportunidadEstado.ABIERTA },
        data: { clienteId },
      });

      return { clienteId, oportunidadesActualizadas: opsActualizadas.count };
    });

    revalidatePath("/crm/leads");
    revalidatePath(`/crm/leads/${leadId}`);
    revalidatePath("/maestros/clientes");
    revalidatePath(`/maestros/clientes/${result.clienteId}`);
    return { ok: true, data: result };
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "LEAD_NOT_FOUND") {
        return { ok: false, error: "El lead no existe." };
      }
      if (err.message === "LEAD_YA_CONVERTIDO") {
        return { ok: false, error: "El lead ya fue convertido a cliente." };
      }
    }
    console.error("convertirLeadEnClienteAction failed", err);
    return { ok: false, error: "Error inesperado al convertir el lead." };
  }
}
