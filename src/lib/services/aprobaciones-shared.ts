import "server-only";

// Primitivas internas compartidas del motor de aprobaciones (PR-012): tipos de
// resultado, constantes de error, guard de la flag, helpers de transacción y de
// carga. Las consumen `aprobaciones.ts` (máquina de estados) y
// `aprobaciones-escalonamiento.ts` (régua SLA) sin ciclos de import.

import { Prisma } from "@/generated/prisma/client";
import type { Solicitud } from "@/generated/prisma/client";
import { EstadoSolicitud } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { isApprovalsEnabled } from "@/lib/features";

/** Resultado de una transición: éxito con la solicitud, o error tipado. */
export type ResultadoAprobacion = { ok: true; solicitud: Solicitud } | { ok: false; error: string };

/** Cliente mínimo de escritura: sirve `db` o un `tx` de $transaction. */
export type AprobacionesTx = Pick<
  Prisma.TransactionClient,
  "solicitud" | "aprobacion" | "auditLog"
>;
type SolicitudReader = Pick<Prisma.TransactionClient, "solicitud">;

export const ERR_NO_ENCONTRADA = "Solicitud no encontrada";
export const ERR_ESTADO = "El estado actual no permite la transición";
export const ERR_PERMISO = "Permiso denegado";
export const ERR_MOTIVO = "El motivo es obligatorio";
export const ERR_YA_APROBO = "El aprobador ya aprobó esta solicitud";

/** Estados desde los que una solicitud todavía puede transicionar. */
export const ESTADOS_ABIERTOS: readonly EstadoSolicitud[] = [
  EstadoSolicitud.PENDIENTE,
  EstadoSolicitud.SOLICITANDO_INFO,
];

/** Lanza si el motor está deshabilitado (garantía de inercia). */
export function assertHabilitado(): void {
  if (!isApprovalsEnabled()) {
    throw new Error("Motor de aprobaciones deshabilitado (APPROVALS_ENABLED=off)");
  }
}

export function err(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

export function tieneMotivo(m: string | null | undefined): boolean {
  return typeof m === "string" && m.trim().length > 0;
}

export function esTransitable(estado: EstadoSolicitud): boolean {
  return ESTADOS_ABIERTOS.includes(estado);
}

export function toJson(
  v: Prisma.InputJsonValue | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return v == null ? Prisma.JsonNull : v;
}

export function cargarSolicitud(client: SolicitudReader, id: string): Promise<Solicitud | null> {
  return client.solicitud.findUnique({ where: { id } });
}

/** Corre `fn` dentro de la `tx` provista o abre una nueva (mutación + audit atómicos). */
export function ejecutar<T>(
  tx: AprobacionesTx | undefined,
  fn: (t: AprobacionesTx) => Promise<T>,
): Promise<T> {
  return tx ? fn(tx) : db.$transaction((t) => fn(t));
}
