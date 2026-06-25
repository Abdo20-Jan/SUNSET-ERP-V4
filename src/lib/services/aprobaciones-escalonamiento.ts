import "server-only";

// Régua de escalonamiento SLA (AUTO-01) del motor de aprobaciones (PR-012).
// `procesarEscalonamientos` es el entry-point que invoca el cron (INERTE por
// defecto). NO envía notificaciones: aplica 50/75/100%, escala un nivel por
// pasada y EXPIRA al agotar la cadena; devuelve intents para que el consumidor
// loguee/notifique. El tiempo entra como `ahora: Date` (determinismo).

import type { Solicitud } from "@/generated/prisma/client";
import { AuditAccion, AuditOrigen, EstadoSolicitud } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { type PermisoKey, PERMISOS } from "@/lib/permisos-catalog";
import {
  type AprobacionesTx,
  assertHabilitado,
  cargarSolicitud,
  ESTADOS_ABIERTOS,
  esTransitable,
} from "./aprobaciones-shared";
import { type BandaSla, computeHito, escalarUnNivel } from "./aprobaciones-helpers";
import { getConfigAprobacion, type TipoAprobacionConfig } from "./aprobaciones-matriz";
import { registrarAuditoria } from "./auditoria";

/** Intent de notificación / efecto de un paso de escalonamiento (no envía nada). */
export interface ResultadoEscalonamiento {
  solicitudId: string;
  accion: "ninguna" | "recordatorio" | "escalado" | "expirado";
  banda?: BandaSla;
  nivel?: number;
  /** Claves de permiso a quienes notificar (lo resuelve el consumidor). */
  destinatarios?: PermisoKey[];
}

/**
 * Recorre las solicitudes abiertas y aplica la régua AUTO-01 (50/75/100%).
 * Cada fila se procesa en su PROPIA transacción (lote reiniciable/idempotente).
 */
export async function procesarEscalonamientos(ahora: Date): Promise<ResultadoEscalonamiento[]> {
  assertHabilitado();
  const abiertas = await db.solicitud.findMany({
    where: { estado: { in: [...ESTADOS_ABIERTOS] } },
    select: { id: true },
  });
  const resultados: ResultadoEscalonamiento[] = [];
  for (const { id } of abiertas) {
    resultados.push(await db.$transaction((t) => avanzarSla(t, id, ahora)));
  }
  return resultados;
}

async function avanzarSla(
  t: AprobacionesTx,
  solicitudId: string,
  ahora: Date,
): Promise<ResultadoEscalonamiento> {
  const s = await cargarSolicitud(t, solicitudId);
  if (!s || !esTransitable(s.estado)) return { solicitudId, accion: "ninguna" };
  const { banda } = computeHito({
    venceEn: s.venceEn,
    slaHoras: s.slaHoras,
    nivelEscalonamiento: s.nivelEscalonamiento,
    ahora,
  });
  if (banda < 100) return emitirRecordatorio(t, s, banda);
  return manejarVencimiento(t, s, ahora);
}

function tierKey(config: TipoAprobacionConfig, nivel: number): PermisoKey {
  return config.escalonamiento[nivel - 1] ?? PERMISOS.APROBAR_MASTER_OVERRIDE;
}

function destinatariosRecordatorio(config: TipoAprobacionConfig, banda: BandaSla): PermisoKey[] {
  if (banda === 75) {
    return [
      config.permisoAprobacion,
      config.escalonamiento[0] ?? PERMISOS.APROBAR_ESCALAR_DIRECTOR,
    ];
  }
  return [config.permisoAprobacion];
}

async function emitirRecordatorio(
  t: AprobacionesTx,
  s: Solicitud,
  banda: BandaSla,
): Promise<ResultadoEscalonamiento> {
  if (banda <= s.ultimoHitoSla) return { solicitudId: s.id, accion: "ninguna", banda };
  await t.solicitud.update({ where: { id: s.id }, data: { ultimoHitoSla: banda } });
  await registrarAuditoria(t, {
    tabla: "Solicitud",
    registroId: s.id,
    accion: AuditAccion.CAMBIO_ESTADO,
    usuarioId: s.solicitanteId,
    datosNuevos: { recordatorioSla: banda },
    origen: AuditOrigen.AUTOMACION,
    motivo: `Recordatorio SLA ${banda}%`,
  });
  return {
    solicitudId: s.id,
    accion: "recordatorio",
    banda,
    destinatarios: destinatariosRecordatorio(getConfigAprobacion(s.tipo), banda),
  };
}

async function manejarVencimiento(
  t: AprobacionesTx,
  s: Solicitud,
  ahora: Date,
): Promise<ResultadoEscalonamiento> {
  const config = getConfigAprobacion(s.tipo);
  if (s.nivelEscalonamiento >= config.escalonamiento.length) {
    return expirar(t, s, ahora);
  }
  const patch = escalarUnNivel({
    slaHoras: s.slaHoras,
    nivelEscalonamiento: s.nivelEscalonamiento,
    ahora,
  });
  await t.solicitud.update({ where: { id: s.id }, data: patch });
  await registrarAuditoria(t, {
    tabla: "Solicitud",
    registroId: s.id,
    accion: AuditAccion.CAMBIO_ESTADO,
    usuarioId: s.solicitanteId,
    datosAnteriores: { nivelEscalonamiento: s.nivelEscalonamiento },
    datosNuevos: {
      nivelEscalonamiento: patch.nivelEscalonamiento,
      venceEn: patch.venceEn.toISOString(),
    },
    origen: AuditOrigen.AUTOMACION,
    motivo: `Escalonamiento automático a nivel ${patch.nivelEscalonamiento}`,
  });
  return {
    solicitudId: s.id,
    accion: "escalado",
    nivel: patch.nivelEscalonamiento,
    destinatarios: [tierKey(config, patch.nivelEscalonamiento)],
  };
}

async function expirar(
  t: AprobacionesTx,
  s: Solicitud,
  ahora: Date,
): Promise<ResultadoEscalonamiento> {
  // Decisión del dono (PR-012): el terminal por defecto es EXPIRADA. El auto
  // Master override (config.autoMasterOverride) queda reservado para el futuro;
  // hoy ningún tipo lo activa, así que tras agotar el escalonamiento se EXPIRA.
  await t.solicitud.update({
    where: { id: s.id },
    data: { estado: EstadoSolicitud.EXPIRADA, resueltaEn: ahora },
  });
  await registrarAuditoria(t, {
    tabla: "Solicitud",
    registroId: s.id,
    accion: AuditAccion.CAMBIO_ESTADO,
    usuarioId: s.solicitanteId,
    datosAnteriores: { estado: s.estado },
    datosNuevos: { estado: EstadoSolicitud.EXPIRADA },
    origen: AuditOrigen.AUTOMACION,
    motivo: "SLA agotado tras el escalonamiento",
  });
  return { solicitudId: s.id, accion: "expirado" };
}
