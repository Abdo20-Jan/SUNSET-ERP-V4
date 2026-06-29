/**
 * Helpers PUROS del Cockpit Operacional Comex (PR-022 / CX-01).
 *
 * Sin I/O, sin `server-only`: los importa el read server-side
 * (`comex-cockpit.ts` → mappers) y son unit-testables. Todas las derivaciones
 * reciben `now` INYECTADO (nunca `Date.now()` interno) para ser deterministas y
 * evitar mismatch de hidratación.
 *
 * ⚠️ NO consumen ni reimplementan el motor de rateio/despacho/costo (G-09 /
 * CRIT-04..09): sólo proyectan campos EXISTENTES en señales de display. Reusan
 * las derivaciones de la worklist (`comex-worklist-derivaciones.ts`) — acá sólo
 * vive lo NUEVO del cockpit (severidad de alerta, banding de frescura,
 * próxima-acción por estado).
 */

import type { EmbarqueEstado } from "@/generated/prisma/client";
import type { EtaTono } from "@/lib/services/comex-worklist-derivaciones";

const MS_DIA = 86_400_000;

/** Umbrales de "proceso sin actualización" (§9 CX-01): amber > 5d, red > 10d. */
const FRESCURA_AMBER_DIAS = 5;
const FRESCURA_RED_DIAS = 10;

export type SeveridadAlerta = "critico" | "atencion" | "ok";
export type BandaActualizacion = "fresca" | "amber" | "red";

/**
 * Severidad de un proceso a partir de señales READ-ONLY ya derivadas:
 * - crítico  → bloqueo (factura local vencida) o ETA vencida.
 * - atención → ETA próxima (< 7d).
 * - ok       → sin señales.
 *
 * Sólo dos señales honestas: `bloqueo` (= `deriveStatusPago === "vencido"`,
 * misma condición, no se duplica) y `etaTono`. Demurrage / free-time NO son
 * derivables (no hay campos en `Contenedor`) → OMITIDOS, no inventados.
 */
export function clasificarSeveridad(input: {
  bloqueo: string | null;
  etaTono: EtaTono;
}): SeveridadAlerta {
  if (input.bloqueo != null || input.etaTono === "overdue") return "critico";
  if (input.etaTono === "soon") return "atencion";
  return "ok";
}

/** Días enteros transcurridos desde `updatedAt` (floor; nunca negativo en uso real). */
export function diasSinActualizacion(updatedAt: Date, now: Date): number {
  return Math.floor((now.getTime() - updatedAt.getTime()) / MS_DIA);
}

/** Banding de frescura por `Embarque.updatedAt` (único proxy honesto: no hay event-log). */
export function bandDiasSinActualizacion(updatedAt: Date, now: Date): BandaActualizacion {
  const dias = diasSinActualizacion(updatedAt, now);
  if (dias > FRESCURA_RED_DIAS) return "red";
  if (dias > FRESCURA_AMBER_DIAS) return "amber";
  return "fresca";
}

/** Próxima acción sugerida por estado (display; no dispara mutación — cockpit read-only). */
const PROXIMA_ACCION: Record<EmbarqueEstado, string> = {
  BORRADOR: "Confirmar datos del embarque",
  EN_TRANSITO: "Seguir ETA y documentación",
  EN_PUERTO: "Coordinar ingreso a zona primaria",
  EN_ZONA_PRIMARIA: "Preparar despacho",
  EN_ADUANA: "Gestionar liberación aduanera",
  DESPACHADO: "Registrar retiro / traslado",
  EN_DEPOSITO: "Cerrar costos del proceso",
  CERRADO: "Proceso cerrado",
};

export function proximaAccionPorEstado(estado: EmbarqueEstado): string {
  return PROXIMA_ACCION[estado];
}
