"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isCrmEnabled } from "@/lib/features";
import {
  resumirLead,
  type ResumenLead,
} from "@/lib/services/crm/lead-summarizer";
import { recalcularScoreLead } from "@/lib/services/crm/scoring-engine";
import { analizarSentimiento } from "@/lib/services/crm/sentiment";
import { Prisma } from "@/generated/prisma/client";

type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const FLAG_OFF_ERROR = {
  ok: false as const,
  error: "CRM no está habilitado (flag CRM_ENABLED=false).",
};

const NO_AUTH = { ok: false as const, error: "No autorizado." };

export async function resumirLeadAction(
  leadId: string,
): Promise<ActionResult<ResumenLead>> {
  if (!isCrmEnabled()) return FLAG_OFF_ERROR;
  const session = await auth();
  if (!session?.user.id) return NO_AUTH;
  if (!leadId) return { ok: false, error: "Id requerido." };

  try {
    const data = await resumirLead(leadId);
    return { ok: true, data };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("ANTHROPIC_API_KEY")) {
      return { ok: false, error: err.message };
    }
    if (err instanceof Error && err.message === "Lead no encontrado.") {
      return { ok: false, error: err.message };
    }
    console.error("resumirLeadAction failed", err);
    return {
      ok: false,
      error: "El asistente no pudo generar el resumen. Probá de nuevo.",
    };
  }
}

export async function recalcularScoringLeadAction(
  leadId: string,
): Promise<ActionResult<{ score: number }>> {
  if (!isCrmEnabled()) return FLAG_OFF_ERROR;
  const session = await auth();
  if (!session?.user.id) return NO_AUTH;
  if (!leadId) return { ok: false, error: "Id requerido." };

  try {
    const score = await recalcularScoreLead(leadId);
    revalidatePath(`/crm/leads/${leadId}`);
    revalidatePath("/crm/leads");
    return { ok: true, data: { score } };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { ok: false, error: "El lead no existe." };
    }
    console.error("recalcularScoringLeadAction failed", err);
    return { ok: false, error: "Error inesperado al recalcular score." };
  }
}

export async function analizarSentimientoActividadAction(
  actividadId: string,
): Promise<ActionResult<{ sentimiento: number; etiqueta: string }>> {
  if (!isCrmEnabled()) return FLAG_OFF_ERROR;
  const session = await auth();
  if (!session?.user.id) return NO_AUTH;
  if (!actividadId) return { ok: false, error: "Id requerido." };

  try {
    const actividad = await db.actividad.findUnique({
      where: { id: actividadId },
      select: { id: true, contenido: true, leadId: true, oportunidadId: true },
    });
    if (!actividad) return { ok: false, error: "Actividad no existe." };

    const result = await analizarSentimiento(actividad.contenido);
    await db.actividad.update({
      where: { id: actividadId },
      data: { sentimiento: new Prisma.Decimal(result.sentimiento) },
    });
    if (actividad.leadId) revalidatePath(`/crm/leads/${actividad.leadId}`);
    if (actividad.oportunidadId) {
      revalidatePath(`/crm/oportunidades/${actividad.oportunidadId}`);
    }
    return { ok: true, data: result };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("ANTHROPIC_API_KEY")) {
      return { ok: false, error: err.message };
    }
    console.error("analizarSentimientoActividadAction failed", err);
    return {
      ok: false,
      error: "El asistente no pudo analizar el sentimiento. Probá de nuevo.",
    };
  }
}
