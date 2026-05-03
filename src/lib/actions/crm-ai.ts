"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { requireCrmAuth } from "@/lib/actions/_crm-helpers";
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

function mapAiError(err: unknown, contexto: string): string {
  if (err instanceof Error) {
    if (err.message.startsWith("ANTHROPIC_API_KEY")) return err.message;
    if (err.message === "Lead no encontrado.") return err.message;
    if (err.message === "Actividad no existe.") return err.message;
  }
  // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring
  console.error(`${contexto} failed`, err);
  return "El asistente no pudo completar la operación. Probá de nuevo.";
}

export async function resumirLeadAction(
  leadId: string,
): Promise<ActionResult<ResumenLead>> {
  const guard = await requireCrmAuth();
  if (!guard.ok) return guard;
  if (!leadId) return { ok: false, error: "Id requerido." };

  try {
    const data = await resumirLead(leadId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: mapAiError(err, "resumirLeadAction") };
  }
}

export async function recalcularScoringLeadAction(
  leadId: string,
): Promise<ActionResult<{ score: number }>> {
  const guard = await requireCrmAuth();
  if (!guard.ok) return guard;
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
  const guard = await requireCrmAuth();
  if (!guard.ok) return guard;
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
    return { ok: false, error: mapAiError(err, "analizarSentimientoActividadAction") };
  }
}
