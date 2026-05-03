"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { requireCrmAuth } from "@/lib/actions/_crm-helpers";
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

function buildSearchFilter(search: string): Prisma.LeadWhereInput {
  const q = search.trim();
  if (q.length === 0) return {};
  return {
    OR: [
      { nombre: { contains: q, mode: "insensitive" } },
      { empresa: { contains: q, mode: "insensitive" } },
      { cuit: { contains: q } },
      { email: { contains: q, mode: "insensitive" } },
    ],
  };
}

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
  if (filtros?.search) Object.assign(where, buildSearchFilter(filtros.search));

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

function parseLeadInput(
  raw: LeadInput,
): { ok: true; data: z.output<typeof leadSchema> } | { ok: false; error: string } {
  const parsed = leadSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  return { ok: true, data: parsed.data };
}

export async function crearLeadAction(
  raw: LeadInput,
): Promise<ActionResult<{ id: string }>> {
  const guard = await requireCrmAuth();
  if (!guard.ok) return guard;

  const validated = parseLeadInput(raw);
  if (!validated.ok) return validated;

  try {
    const created = await db.lead.create({
      data: { ...validated.data, ownerId: guard.userId },
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
  const guard = await requireCrmAuth();
  if (!guard.ok) return guard;
  if (!id) return { ok: false, error: "Id requerido." };

  const validated = parseLeadInput(raw);
  if (!validated.ok) return validated;

  try {
    const updated = await db.lead.update({
      where: { id },
      data: validated.data,
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
  const guard = await requireCrmAuth();
  if (!guard.ok) return guard;
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

type LeadConContactos = Prisma.LeadGetPayload<{ include: { contactos: true } }>;

async function findOrCreateClienteFromLead(
  tx: Prisma.TransactionClient,
  lead: LeadConContactos,
): Promise<string> {
  if (lead.cuit) {
    const existente = await tx.cliente.findUnique({
      where: { cuit: lead.cuit },
      select: { id: true },
    });
    if (existente) return existente.id;
  }
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
  return nuevo.id;
}

async function ejecutarConversion(
  tx: Prisma.TransactionClient,
  leadId: string,
): Promise<{ clienteId: string; oportunidadesActualizadas: number }> {
  const lead = await tx.lead.findUnique({
    where: { id: leadId },
    include: { contactos: true },
  });
  if (!lead) throw new Error("LEAD_NOT_FOUND");
  if (lead.clienteId) throw new Error("LEAD_YA_CONVERTIDO");

  const clienteId = await findOrCreateClienteFromLead(tx, lead);

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

  const ops = await tx.oportunidad.updateMany({
    where: { leadId, clienteId: null, estado: OportunidadEstado.ABIERTA },
    data: { clienteId },
  });

  return { clienteId, oportunidadesActualizadas: ops.count };
}

function mapConvertirError(err: unknown): string {
  if (err instanceof Error) {
    if (err.message === "LEAD_NOT_FOUND") return "El lead no existe.";
    if (err.message === "LEAD_YA_CONVERTIDO") {
      return "El lead ya fue convertido a cliente.";
    }
  }
  console.error("convertirLeadEnClienteAction failed", err);
  return "Error inesperado al convertir el lead.";
}

export async function convertirLeadEnClienteAction(
  leadId: string,
): Promise<ActionResult<{ clienteId: string; oportunidadesActualizadas: number }>> {
  const guard = await requireCrmAuth();
  if (!guard.ok) return guard;

  try {
    const result = await db.$transaction((tx) => ejecutarConversion(tx, leadId));
    revalidatePath("/crm/leads");
    revalidatePath(`/crm/leads/${leadId}`);
    revalidatePath("/maestros/clientes");
    revalidatePath(`/maestros/clientes/${result.clienteId}`);
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: mapConvertirError(err) };
  }
}
