"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isCrmEnabled } from "@/lib/features";
import {
  Moneda,
  OportunidadEstado,
  Prisma,
} from "@/generated/prisma/client";

type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const FLAG_OFF_ERROR = {
  ok: false as const,
  error: "CRM no está habilitado (flag CRM_ENABLED=false).",
};

const NO_AUTH = { ok: false as const, error: "No autorizado." };

const moneyRegex = /^\d+(\.\d{1,2})?$/;

const oportunidadSchema = z
  .object({
    titulo: z.string().trim().min(1, "El título es obligatorio."),
    monto: z.string().regex(moneyRegex, "Monto inválido (máx. 2 decimales)."),
    moneda: z.nativeEnum(Moneda).default(Moneda.USD),
    stageId: z.string().min(1, "Stage requerido."),
    probabilidad: z.coerce.number().int().min(0).max(100).default(50),
    cierreEstimado: z.coerce.date().optional().nullable(),
    leadId: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
    clienteId: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
    notas: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
  })
  .refine((v) => v.leadId !== null || v.clienteId !== null, {
    message: "Debe asociarse a un lead o un cliente.",
  });

export type OportunidadInput = z.input<typeof oportunidadSchema>;

async function generarNumeroOportunidad(
  tx: Prisma.TransactionClient,
): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `O-${year}-`;
  const ultimo = await tx.oportunidad.findFirst({
    where: { numero: { startsWith: prefix } },
    orderBy: { numero: "desc" },
    select: { numero: true },
  });
  let next = 1;
  if (ultimo) {
    const parsed = Number.parseInt(ultimo.numero.slice(prefix.length), 10);
    if (!Number.isNaN(parsed)) next = parsed + 1;
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
}

export async function listarOportunidades(filtros?: {
  estado?: OportunidadEstado;
  ownerId?: string;
  stageId?: string;
}) {
  const where: Prisma.OportunidadWhereInput = {};
  if (filtros?.estado) where.estado = filtros.estado;
  if (filtros?.ownerId) where.ownerId = filtros.ownerId;
  if (filtros?.stageId) where.stageId = filtros.stageId;

  const rows = await db.oportunidad.findMany({
    where,
    orderBy: [{ estado: "asc" }, { createdAt: "desc" }],
    include: {
      stage: { select: { nombre: true, orden: true, esGanada: true, esPerdida: true } },
      lead: { select: { id: true, nombre: true, empresa: true } },
      cliente: { select: { id: true, nombre: true } },
      owner: { select: { id: true, nombre: true } },
    },
  });

  return rows.map((o) => ({
    id: o.id,
    numero: o.numero,
    titulo: o.titulo,
    monto: o.monto.toString(),
    moneda: o.moneda,
    stageId: o.stageId,
    stageNombre: o.stage.nombre,
    stageOrden: o.stage.orden,
    probabilidad: o.probabilidad,
    cierreEstimado: o.cierreEstimado,
    estado: o.estado,
    leadId: o.leadId,
    leadNombre: o.lead?.nombre ?? null,
    leadEmpresa: o.lead?.empresa ?? null,
    clienteId: o.clienteId,
    clienteNombre: o.cliente?.nombre ?? null,
    ownerId: o.ownerId,
    ownerNombre: o.owner.nombre,
    notas: o.notas,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  }));
}

export async function getOportunidad(id: string) {
  return db.oportunidad.findUnique({
    where: { id },
    include: {
      stage: true,
      lead: { select: { id: true, nombre: true, empresa: true } },
      cliente: { select: { id: true, nombre: true } },
      owner: { select: { id: true, nombre: true } },
      actividades: {
        orderBy: [{ completada: "asc" }, { fechaProgramada: "asc" }, { createdAt: "desc" }],
        include: { owner: { select: { nombre: true } } },
      },
    },
  });
}

export async function crearOportunidadAction(
  raw: OportunidadInput,
): Promise<ActionResult<{ id: string; numero: string }>> {
  if (!isCrmEnabled()) return FLAG_OFF_ERROR;
  const session = await auth();
  if (!session?.user.id) return NO_AUTH;

  const parsed = oportunidadSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Datos inválidos." };
  }

  try {
    const created = await db.$transaction(async (tx) => {
      const numero = await generarNumeroOportunidad(tx);
      return tx.oportunidad.create({
        data: {
          numero,
          titulo: parsed.data.titulo,
          monto: new Prisma.Decimal(parsed.data.monto),
          moneda: parsed.data.moneda,
          stageId: parsed.data.stageId,
          probabilidad: parsed.data.probabilidad,
          cierreEstimado: parsed.data.cierreEstimado ?? null,
          leadId: parsed.data.leadId,
          clienteId: parsed.data.clienteId,
          notas: parsed.data.notas,
          ownerId: session.user.id,
        },
        select: { id: true, numero: true },
      });
    });
    revalidatePath("/crm/oportunidades");
    revalidatePath("/crm/oportunidades/pipeline");
    if (parsed.data.leadId) revalidatePath(`/crm/leads/${parsed.data.leadId}`);
    return { ok: true, data: created };
  } catch (err) {
    console.error("crearOportunidadAction failed", err);
    return { ok: false, error: "Error inesperado al crear la oportunidad." };
  }
}

export async function editarOportunidadAction(
  id: string,
  raw: OportunidadInput,
): Promise<ActionResult<{ id: string }>> {
  if (!isCrmEnabled()) return FLAG_OFF_ERROR;
  const session = await auth();
  if (!session?.user.id) return NO_AUTH;
  if (!id) return { ok: false, error: "Id requerido." };

  const parsed = oportunidadSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Datos inválidos." };
  }

  try {
    const updated = await db.oportunidad.update({
      where: { id },
      data: {
        titulo: parsed.data.titulo,
        monto: new Prisma.Decimal(parsed.data.monto),
        moneda: parsed.data.moneda,
        stageId: parsed.data.stageId,
        probabilidad: parsed.data.probabilidad,
        cierreEstimado: parsed.data.cierreEstimado ?? null,
        leadId: parsed.data.leadId,
        clienteId: parsed.data.clienteId,
        notas: parsed.data.notas,
      },
      select: { id: true },
    });
    revalidatePath("/crm/oportunidades");
    revalidatePath(`/crm/oportunidades/${id}`);
    revalidatePath("/crm/oportunidades/pipeline");
    return { ok: true, data: { id: updated.id } };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { ok: false, error: "La oportunidad no existe." };
    }
    console.error("editarOportunidadAction failed", err);
    return { ok: false, error: "Error inesperado al actualizar la oportunidad." };
  }
}

export async function moverStageAction(
  id: string,
  stageId: string,
): Promise<ActionResult<{ id: string; estadoFinal: OportunidadEstado }>> {
  if (!isCrmEnabled()) return FLAG_OFF_ERROR;
  const session = await auth();
  if (!session?.user.id) return NO_AUTH;
  if (!id || !stageId) return { ok: false, error: "Id y stageId requeridos." };

  try {
    const result = await db.$transaction(async (tx) => {
      const stage = await tx.pipelineStage.findUnique({
        where: { id: stageId },
        select: { esGanada: true, esPerdida: true },
      });
      if (!stage) throw new Error("STAGE_NOT_FOUND");

      let estado: OportunidadEstado = OportunidadEstado.ABIERTA;
      if (stage.esGanada) estado = OportunidadEstado.GANADA;
      else if (stage.esPerdida) estado = OportunidadEstado.PERDIDA;

      const updated = await tx.oportunidad.update({
        where: { id },
        data: { stageId, estado },
        select: { id: true, estado: true },
      });
      return updated;
    });
    revalidatePath("/crm/oportunidades");
    revalidatePath(`/crm/oportunidades/${id}`);
    revalidatePath("/crm/oportunidades/pipeline");
    return { ok: true, data: { id: result.id, estadoFinal: result.estado } };
  } catch (err) {
    if (err instanceof Error && err.message === "STAGE_NOT_FOUND") {
      return { ok: false, error: "Stage no existe." };
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { ok: false, error: "La oportunidad no existe." };
    }
    console.error("moverStageAction failed", err);
    return { ok: false, error: "Error inesperado al mover la oportunidad." };
  }
}

async function cerrarOportunidad(
  id: string,
  resultado: "GANADA" | "PERDIDA",
): Promise<ActionResult<undefined>> {
  if (!isCrmEnabled()) return FLAG_OFF_ERROR;
  const session = await auth();
  if (!session?.user.id) return NO_AUTH;

  try {
    await db.$transaction(async (tx) => {
      const stage = await tx.pipelineStage.findFirst({
        where: resultado === "GANADA" ? { esGanada: true } : { esPerdida: true },
        orderBy: { orden: "asc" },
        select: { id: true },
      });
      if (!stage) throw new Error("STAGE_NOT_FOUND");
      const estado =
        resultado === "GANADA"
          ? OportunidadEstado.GANADA
          : OportunidadEstado.PERDIDA;
      await tx.oportunidad.update({
        where: { id },
        data: { estado, stageId: stage.id },
      });
    });
    revalidatePath("/crm/oportunidades");
    revalidatePath(`/crm/oportunidades/${id}`);
    revalidatePath("/crm/oportunidades/pipeline");
    return { ok: true, data: undefined };
  } catch (err) {
    if (err instanceof Error && err.message === "STAGE_NOT_FOUND") {
      return {
        ok: false,
        error: "No hay stage configurado para ese resultado. Verificá pipeline.",
      };
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { ok: false, error: "La oportunidad no existe." };
    }
    console.error("cerrarOportunidad failed", err);
    return { ok: false, error: "Error inesperado al cerrar la oportunidad." };
  }
}

export async function cerrarGanadaAction(id: string) {
  return cerrarOportunidad(id, "GANADA");
}

export async function cerrarPerdidaAction(id: string) {
  return cerrarOportunidad(id, "PERDIDA");
}
