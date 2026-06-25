// Helpers PUROS del motor de aprobaciones (PR-012). Sin I/O, sin `server-only`:
// son las costuras unit-testeables que mantienen `aprobaciones.ts` como pura
// orquestación (complejidad ciclomática ≤ 8 · gate Codacy). El tiempo SIEMPRE
// entra como `ahora: Date` explícito (determinismo; nada de Date.now()).

import { AuditAccion, AuditOrigen, EstadoSolicitud } from "@/generated/prisma/enums";

/** Suma `horas` (puede ser fraccional) a una fecha base, sin mutarla. */
export function addHoras(base: Date, horas: number): Date {
  return new Date(base.getTime() + horas * 3_600_000);
}

/** Hito de SLA alcanzado (régua AUTO-01): 0 = nada · 50 · 75 · 100 = vencido. */
export type BandaSla = 0 | 50 | 75 | 100;

/** Mapea una fracción de tiempo transcurrido [0..∞) a su banda de hito. */
export function bandaDeFraccion(pct: number): BandaSla {
  if (pct >= 1) return 100;
  if (pct >= 0.75) return 75;
  if (pct >= 0.5) return 50;
  return 0;
}

/**
 * Ancho de la ventana de SLA vigente en horas. En el nivel base es el SLA
 * completo; tras cualquier escalonamiento el aprobador recibe 50% del SLA
 * original (AUTO-01).
 */
export function ventanaHoras(slaHoras: number, nivelEscalonamiento: number): number {
  return nivelEscalonamiento === 0 ? slaHoras : slaHoras / 2;
}

/**
 * Calcula la banda de hito y la fracción transcurrida de una solicitud, contra
 * `ahora`. La ventana se deriva del nivel de escalonamiento (50% tras escalar).
 */
export function computeHito(input: {
  venceEn: Date;
  slaHoras: number;
  nivelEscalonamiento: number;
  ahora: Date;
}): { banda: BandaSla; pct: number } {
  const ms = ventanaHoras(input.slaHoras, input.nivelEscalonamiento) * 3_600_000;
  if (ms <= 0) return { banda: 100, pct: 1 };
  const inicioMs = input.venceEn.getTime() - ms;
  const pct = (input.ahora.getTime() - inicioMs) / ms;
  return { banda: bandaDeFraccion(pct), pct };
}

/**
 * Patch de un avance de UN nivel de escalonamiento: sube el nivel, reinicia el
 * deadline a `ahora + 50% del SLA original` y resetea el hito (recordatorios
 * frescos en la ventana acortada).
 */
export function escalarUnNivel(input: {
  slaHoras: number;
  nivelEscalonamiento: number;
  ahora: Date;
}): { nivelEscalonamiento: number; venceEn: Date; ultimoHitoSla: number } {
  return {
    nivelEscalonamiento: input.nivelEscalonamiento + 1,
    venceEn: addHoras(input.ahora, input.slaHoras / 2),
    ultimoHitoSla: 0,
  };
}

/** Cantidad de aprobaciones DISTINTAS necesarias (2 si dupla, 1 si simple). */
export function aprobacionesRequeridas(requiereDupla: boolean): number {
  return requiereDupla ? 2 : 1;
}

/**
 * Resuelve el estado tras una aprobación: si se alcanzó el cupo (1 o 2 distintas)
 * la solicitud queda APROBADA; si falta el 2º aprobador de una dupla, sigue
 * PENDIENTE (aprobación parcial).
 */
export function aplicarDupla(
  requiereDupla: boolean,
  aprobacionesDistintas: number,
): { estado: EstadoSolicitud; resuelta: boolean } {
  const resuelta = aprobacionesDistintas >= aprobacionesRequeridas(requiereDupla);
  return {
    estado: resuelta ? EstadoSolicitud.APROBADA : EstadoSolicitud.PENDIENTE,
    resuelta,
  };
}

/** Acción + origen de auditoría de una aprobación (Master override vs normal). */
export function auditDeAprobacion(esMasterOverride: boolean): {
  accion: AuditAccion;
  origen: AuditOrigen;
} {
  return esMasterOverride
    ? { accion: AuditAccion.MASTER_OVERRIDE, origen: AuditOrigen.MASTER_OVERRIDE }
    : { accion: AuditAccion.APROBACION, origen: AuditOrigen.MANUAL };
}
