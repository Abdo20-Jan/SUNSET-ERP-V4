"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isContenedorDesconsolidacionEnabled } from "@/lib/features";
import {
  abrirInvestigacion,
  arquivarInvestigacion,
  concluirInvestigacion,
  diagnosticarCausa,
  DivergenciaError,
  registrarConferenciaFisica,
} from "@/lib/services/divergencia-investigacion";
import { DivergenciaCausa, DivergenciaResp } from "@/generated/prisma/client";

// PR 3.5 — actions de la investigación de divergencia (D9). Espejan el patrón
// de desconsolidacion.ts: gate (flag + auth) → safeParse → service →
// mapError(DivergenciaError) → revalidatePath. usuarioId/closedBy se omiten
// (mismatch Int × uuid, igual que en 3.4 — follow-up de schema).

type ActionResult<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

function mapDivergenciaError(err: DivergenciaError): string {
  switch (err.code) {
    case "DESCONSOLIDACION_INEXISTENTE":
      return "El contenedor no fue desconsolidado todavía.";
    case "INVESTIGACION_INEXISTENTE":
      return "La investigación no existe.";
    case "INVESTIGACION_DUPLICADA":
      return "Ya existe una investigación abierta para este contenedor.";
    case "SIN_DIVERGENCIA":
      return "El contenedor no presenta diferencias entre físico y declarado.";
    case "COSTO_NO_DISPONIBLE":
      return "Falta el costo FC unitario para valuar la divergencia (cerrá costos).";
    case "ESTADO_INVALIDO":
      return "La investigación ya fue concluida o archivada.";
    case "CAUSA_INCOHERENTE":
      return "La causa y el responsable indicados no son coherentes.";
    case "CAUSA_NO_DIAGNOSTICADA":
      return "Diagnosticá la causa antes de concluir.";
    case "CUENTA_REQUERIDA":
      return "Indicá la cuenta por cobrar al responsable de la falta.";
    case "TIPO_CAMBIO_INVALIDO":
      return "El embarque no tiene un tipo de cambio válido.";
    default:
      return "Error al procesar la investigación.";
  }
}

async function gate(): Promise<{ ok: false; error: string } | null> {
  if (!isContenedorDesconsolidacionEnabled()) {
    return { ok: false, error: "La función de desconsolidación no está habilitada." };
  }
  const session = await auth();
  if (!session) {
    return { ok: false, error: "No autorizado." };
  }
  return null;
}

function revalidar(contenedorId: string, embarqueId?: string): void {
  revalidatePath(`/comex/contenedores/${contenedorId}/investigacion`);
  if (embarqueId) revalidatePath(`/comex/embarques/${embarqueId}`);
}

// ---- abrir -----------------------------------------------------------

const abrirSchema = z.object({ contenedorId: z.string().min(1) });

export async function abrirInvestigacionAction(
  input: z.input<typeof abrirSchema>,
): Promise<ActionResult<{ investigacionId: string }>> {
  const blocked = await gate();
  if (blocked) return blocked;
  const parsed = abrirSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  try {
    const desc = await db.desconsolidacion.findUnique({
      where: { contenedorId: parsed.data.contenedorId },
      select: { id: true },
    });
    if (!desc) {
      return { ok: false, error: "El contenedor no fue desconsolidado todavía." };
    }
    const investigacion = await abrirInvestigacion({ desconsolidacionId: desc.id });
    revalidar(parsed.data.contenedorId);
    return { ok: true, investigacionId: investigacion.id };
  } catch (err) {
    if (err instanceof DivergenciaError) return { ok: false, error: mapDivergenciaError(err) };
    console.error("abrirInvestigacionAction failed", err);
    return { ok: false, error: "Error inesperado al abrir la investigación." };
  }
}

// ---- conferencia física ----------------------------------------------

const conferenciaSchema = z.object({
  investigacionId: z.string().min(1),
  contenedorId: z.string().min(1),
  pesoContenedorKg: z.string().trim().optional(),
  pesoEsperadoKg: z.string().trim().optional(),
  lacreOrigemOk: z.boolean().optional(),
  lacreOrigemObs: z.string().trim().optional(),
  lacrePemaOk: z.boolean().optional(),
  lacreCustomsOk: z.boolean().optional(),
  gravacaoDescargaUrl: z.string().url().optional(),
  fotosUrls: z.array(z.string().url()).optional(),
  documentosUrls: z.array(z.string().url()).optional(),
});

export async function registrarConferenciaAction(
  input: z.input<typeof conferenciaSchema>,
): Promise<ActionResult> {
  const blocked = await gate();
  if (blocked) return blocked;
  const parsed = conferenciaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const { investigacionId, contenedorId, ...datos } = parsed.data;

  try {
    await registrarConferenciaFisica(investigacionId, datos);
    revalidar(contenedorId);
    return { ok: true };
  } catch (err) {
    if (err instanceof DivergenciaError) return { ok: false, error: mapDivergenciaError(err) };
    console.error("registrarConferenciaAction failed", err);
    return { ok: false, error: "Error inesperado al guardar la conferencia." };
  }
}

// ---- diagnóstico de causa --------------------------------------------

const diagnosticoSchema = z.object({
  investigacionId: z.string().min(1),
  contenedorId: z.string().min(1),
  causa: z.nativeEnum(DivergenciaCausa),
  responsavelTipo: z.nativeEnum(DivergenciaResp),
  responsavelId: z.string().trim().optional(),
  polizaSeguro: z.string().trim().optional(),
});

export async function diagnosticarCausaAction(
  input: z.input<typeof diagnosticoSchema>,
): Promise<ActionResult> {
  const blocked = await gate();
  if (blocked) return blocked;
  const parsed = diagnosticoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const { investigacionId, contenedorId, ...datos } = parsed.data;

  try {
    await diagnosticarCausa(investigacionId, datos);
    revalidar(contenedorId);
    return { ok: true };
  } catch (err) {
    if (err instanceof DivergenciaError) return { ok: false, error: mapDivergenciaError(err) };
    console.error("diagnosticarCausaAction failed", err);
    return { ok: false, error: "Error inesperado al diagnosticar la causa." };
  }
}

// ---- concluir --------------------------------------------------------

const concluirSchema = z.object({
  investigacionId: z.string().min(1),
  contenedorId: z.string().min(1),
  embarqueId: z.string().min(1).optional(),
  fecha: z.coerce.date(),
  cuentaPorCobrarId: z.number().int().positive().optional(),
});

export async function concluirInvestigacionAction(
  input: z.input<typeof concluirSchema>,
): Promise<ActionResult<{ asientoId: string | null }>> {
  const blocked = await gate();
  if (blocked) return blocked;
  const parsed = concluirSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const { investigacionId, contenedorId, embarqueId, fecha, cuentaPorCobrarId } = parsed.data;

  try {
    const { asiento } = await concluirInvestigacion(investigacionId, { fecha, cuentaPorCobrarId });
    revalidar(contenedorId, embarqueId);
    return { ok: true, asientoId: asiento?.id ?? null };
  } catch (err) {
    if (err instanceof DivergenciaError) return { ok: false, error: mapDivergenciaError(err) };
    console.error("concluirInvestigacionAction failed", err);
    return { ok: false, error: "Error inesperado al concluir la investigación." };
  }
}

// ---- archivar --------------------------------------------------------

const arquivarSchema = z.object({
  investigacionId: z.string().min(1),
  contenedorId: z.string().min(1),
  embarqueId: z.string().min(1).optional(),
  motivo: z.string().trim().optional(),
});

export async function arquivarInvestigacionAction(
  input: z.input<typeof arquivarSchema>,
): Promise<ActionResult> {
  const blocked = await gate();
  if (blocked) return blocked;
  const parsed = arquivarSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const { investigacionId, contenedorId, embarqueId, motivo } = parsed.data;

  try {
    await arquivarInvestigacion(investigacionId, { motivo });
    revalidar(contenedorId, embarqueId);
    return { ok: true };
  } catch (err) {
    if (err instanceof DivergenciaError) return { ok: false, error: mapDivergenciaError(err) };
    console.error("arquivarInvestigacionAction failed", err);
    return { ok: false, error: "Error inesperado al archivar la investigación." };
  }
}
