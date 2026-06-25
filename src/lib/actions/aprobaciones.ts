"use server";

// Server actions DELGADAS de la Central de Aprobaciones (AUTO-01 / PR-013).
// Sólo adaptan input/permiso/erro y DELEGAN en el motor PR-012 (crearSolicitud /
// aprobar / rechazar / solicitarInformacion / cancelar) — sin lógica de negocio
// nueva. El motor ya gatea permiso (hasPermission), audita en la misma tx y lanza
// si APPROVALS_ENABLED=off. **Crear una Solicitud NO bloquea ninguna acción de
// negocio**: el enforcement es por-flujo y llega después (PR-014 liga margen).

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { Role } from "@/generated/prisma/client";
import { Moneda, TipoAprobacion } from "@/generated/prisma/enums";
import { requireSessionUser } from "@/lib/auth-guard";
import { PERMISOS, requirePermission } from "@/lib/permisos";
import { getRequestIp } from "@/lib/services/admin-guard";
import {
  aprobar,
  cancelar,
  crearSolicitud,
  rechazar,
  solicitarInformacion,
} from "@/lib/services/aprobaciones";
import { getSolicitudParaDecision, type SolicitudDetalle } from "@/lib/services/aprobaciones-query";

export type AprobacionActionResult = { ok: true } | { ok: false; error: string };

const CENTRAL_PATH = "/sistema/aprobaciones";

// El motor lanza si la flag está off (assertHabilitado) o ante invariantes; lo
// surfaceamos como mensaje amable en vez de "Error inesperado".
function fallo(e: unknown): { ok: false; error: string } {
  const msg = e instanceof Error ? e.message : "No se pudo completar la operación.";
  return { ok: false, error: msg };
}

function revalidar(extra?: string | null): void {
  revalidatePath(CENTRAL_PATH);
  revalidatePath("/dashboard");
  if (extra) revalidatePath(extra);
}

async function actorActual(): Promise<{ userId: string; esAdmin: boolean }> {
  const userId = await requireSessionUser(); // fuera de try/catch: redirige si la sesión es inválida
  const session = await auth();
  return { userId, esAdmin: session?.user?.role === Role.ADMIN };
}

// ── Lectura del detalle para la janela de decisão (gateada por aprobaciones.ver) ─

export async function cargarDetalleAprobacionAction(id: string): Promise<SolicitudDetalle | null> {
  const guard = await requirePermission(PERMISOS.APROBACIONES_VER);
  if (!guard.ok) return null;
  return getSolicitudParaDecision(id);
}

// ── Decisiones del aprobador ──────────────────────────────────────────────────

const aprobarSchema = z.object({
  solicitudId: z.string().min(1),
  comentario: z.string().trim().max(2000).optional(),
  esMasterOverride: z.boolean().optional(),
});

export async function aprobarAction(
  input: z.input<typeof aprobarSchema>,
): Promise<AprobacionActionResult> {
  const { userId } = await actorActual();
  const parsed = aprobarSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Entrada inválida." };
  try {
    const ip = await getRequestIp();
    const r = await aprobar({
      solicitudId: parsed.data.solicitudId,
      aprobadorId: userId,
      comentario: parsed.data.comentario ?? null,
      esMasterOverride: parsed.data.esMasterOverride ?? false,
      ip,
      ahora: new Date(),
    });
    if (!r.ok) return r;
    revalidar();
    return { ok: true };
  } catch (e) {
    return fallo(e);
  }
}

const rechazarSchema = z.object({
  solicitudId: z.string().min(1),
  motivo: z.string().trim().min(1, "El motivo es obligatorio.").max(500),
});

export async function rechazarAction(
  input: z.input<typeof rechazarSchema>,
): Promise<AprobacionActionResult> {
  const { userId } = await actorActual();
  const parsed = rechazarSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "El motivo es obligatorio." };
  try {
    const ip = await getRequestIp();
    const r = await rechazar({
      solicitudId: parsed.data.solicitudId,
      aprobadorId: userId,
      motivo: parsed.data.motivo,
      ip,
      ahora: new Date(),
    });
    if (!r.ok) return r;
    revalidar();
    return { ok: true };
  } catch (e) {
    return fallo(e);
  }
}

const solicitarInfoSchema = z.object({
  solicitudId: z.string().min(1),
  comentario: z.string().trim().min(1, "Escribí qué información necesitás.").max(2000),
});

export async function solicitarInfoAction(
  input: z.input<typeof solicitarInfoSchema>,
): Promise<AprobacionActionResult> {
  const { userId } = await actorActual();
  const parsed = solicitarInfoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Escribí qué información necesitás." };
  try {
    const ip = await getRequestIp();
    const r = await solicitarInformacion({
      solicitudId: parsed.data.solicitudId,
      aprobadorId: userId,
      comentario: parsed.data.comentario,
      ip,
      ahora: new Date(),
    });
    if (!r.ok) return r;
    revalidar();
    return { ok: true };
  } catch (e) {
    return fallo(e);
  }
}

const cancelarSchema = z.object({
  solicitudId: z.string().min(1),
  motivo: z.string().trim().min(1, "El motivo es obligatorio.").max(500),
});

export async function cancelarAction(
  input: z.input<typeof cancelarSchema>,
): Promise<AprobacionActionResult> {
  const { userId, esAdmin } = await actorActual();
  const parsed = cancelarSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "El motivo es obligatorio." };
  try {
    const ip = await getRequestIp();
    const r = await cancelar({
      solicitudId: parsed.data.solicitudId,
      usuarioId: userId,
      motivo: parsed.data.motivo,
      esAdmin,
      ip,
      ahora: new Date(),
    });
    if (!r.ok) return r;
    revalidar();
    return { ok: true };
  } catch (e) {
    return fallo(e);
  }
}

// ── Creación de solicitud (genérica · botón "Solicitar autorización") ─────────

const crearSchema = z.object({
  tipo: z.nativeEnum(TipoAprobacion),
  tabla: z.string().min(1),
  registroId: z.string().min(1),
  motivo: z.string().trim().min(1, "El motivo es obligatorio.").max(500),
  valor: z.union([z.string(), z.number()]).nullish(),
  moneda: z.nativeEnum(Moneda).nullish(),
  /** Ruta del documento host a revalidar (la aba contextual la pasa). */
  revalidar: z.string().optional(),
});

export async function crearSolicitudAction(
  input: z.input<typeof crearSchema>,
): Promise<AprobacionActionResult> {
  const { userId } = await actorActual();
  const parsed = crearSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Entrada inválida (revisá tipo y motivo)." };
  try {
    await crearSolicitud({
      tipo: parsed.data.tipo,
      tabla: parsed.data.tabla,
      registroId: parsed.data.registroId,
      solicitanteId: userId,
      motivo: parsed.data.motivo,
      valor: parsed.data.valor ?? null,
      moneda: parsed.data.moneda ?? null,
      ahora: new Date(),
    });
    revalidar(parsed.data.revalidar ?? null);
    return { ok: true };
  } catch (e) {
    return fallo(e);
  }
}
