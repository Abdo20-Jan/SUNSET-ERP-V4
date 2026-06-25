import "server-only";

import { headers } from "next/headers";

import { db } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth-guard";
import { registrarAuditoria } from "@/lib/services/auditoria";

/** IP del request (X-Forwarded-For / X-Real-IP) para auditar la exportación. */
async function obtenerIp(): Promise<string | null> {
  try {
    const h = await headers();
    const xff = h.get("x-forwarded-for");
    if (xff) return xff.split(",")[0]?.trim() ?? null;
    return h.get("x-real-ip");
  } catch {
    return null;
  }
}

// Helper REUTILIZABLE de meta-auditoría de exportaciones (AUD-01). Registra un
// evento EXPORTACION cuando una página exporta datos (usuario, fecha, filtros,
// columnas, nº filas, formato, IP). CONSUME `registrarAuditoria` (no lo
// modifica): es un APPEND de un nuevo evento, jamás muta/borra auditoría
// existente → respeta la inmutabilidad G-07/CRIT-11.
//
// Pensado para que otras páginas lo adopten luego (pasar su propio `recurso`).
// Esta PR sólo lo cablea en la exportación de la propia worklist de auditoría.

export type AuditarExportacionInput = {
  /** Página/recurso exportado (ej.: "auditoria"). Va en `datosNuevos.pagina`. */
  recurso: string;
  /** Snapshot serializable de los filtros aplicados. */
  filtros: unknown;
  /** Cabeceras de las columnas exportadas. */
  columnas: string[];
  /** Cantidad de filas exportadas. */
  nFilas: number;
  formato: "csv" | "xlsx";
};

/**
 * Graba el evento EXPORTACION. Usa `db` directo (sin $transaction): es un único
 * insert, ya atómico, y no hay mutación de negocio con la que ser atómico. El
 * `usuarioId` viene de `requireSessionUser()` (FK-safe). Si la grabación falla,
 * propaga el error — el caller (acción de export) NO debe entregar datos sin
 * registrar la exportación.
 */
export async function auditarExportacion(input: AuditarExportacionInput): Promise<void> {
  const usuarioId = await requireSessionUser();
  const ip = await obtenerIp();
  await registrarAuditoria(db, {
    tabla: "AuditLog",
    registroId: "export",
    accion: "EXPORTACION",
    usuarioId,
    datosNuevos: {
      pagina: input.recurso,
      filtros: input.filtros,
      columnas: input.columnas,
      nFilas: input.nFilas,
      formato: input.formato,
    },
    motivo: `Exportación de auditoría (${input.nFilas} filas, ${input.formato})`,
    origen: "MANUAL",
    ip,
  });
}
