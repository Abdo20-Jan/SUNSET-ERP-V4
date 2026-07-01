"use server";

/**
 * PR-023c (CX-06) — Lectura gateada de la MEMORIA DE CÁLCULO del despacho
 * (para la MemoriaCalculoWindow y el botón Simular).
 *
 * Read-only puro: gatea `VER_COSTO_LANDED` server-side ANTES de tocar los datos
 * (sin permiso NO se invoca `obtenerMemoriaDespacho` ni se serializa ningún
 * valor sensible) y delega en `leerMemoriaDetalle` (que envuelve el motor
 * golden-protegido SIN escribir). NO importa el motor/asiento/stock: sólo el
 * proyector read-only + el gate de permiso.
 *
 * `simularMemoriaAction` === `verMemoriaAction`: "Simular" es un RE-PREVIEW
 * read-only sobre los datos ACTUALES (sin input editable, sin escenario
 * alternativo, sin nuevo motor, sin escritura). Byte-estable BORRADOR↔CONTABILIZADO
 * (golden PR-023-pre, CRIT-05 caso a).
 */

import { hasPermission, PERMISOS } from "@/lib/permisos";
import { leerMemoriaDetalle, type MemoriaDetalle } from "@/lib/services/despacho-memoria-vista";

export type VerMemoriaResult =
  | { ok: true; detalle: MemoriaDetalle }
  | { ok: false; reason: "SIN_PERMISO" | "SIN_MEMORIA" | "COSTOS_ABIERTOS" };

/** Gate único `VER_COSTO_LANDED` server-side + lectura read-only. Sin permiso
 * corta ANTES de leer/proyectar (ningún valor de costo se computa ni cruza). */
async function leerGated(despachoId: string): Promise<VerMemoriaResult> {
  if (!(await hasPermission(PERMISOS.VER_COSTO_LANDED))) {
    return { ok: false, reason: "SIN_PERMISO" };
  }
  return leerMemoriaDetalle(despachoId);
}

export async function verMemoriaAction(despachoId: string): Promise<VerMemoriaResult> {
  return leerGated(despachoId);
}

/** Simular = re-preview read-only sobre los datos actuales (misma función real). */
export async function simularMemoriaAction(despachoId: string): Promise<VerMemoriaResult> {
  return leerGated(despachoId);
}
