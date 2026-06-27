/**
 * Helpers PUROS de la worklist Comex de procesos (PR-020 / CX-02).
 *
 * Sin I/O, sin `server-only`: lo importan tanto el read server-side
 * (`listarEmbarques` → mapper) como las columnas client (tonos/labels). Todas las
 * derivaciones reciben `now` INYECTADO (nunca `Date.now()` interno) para ser
 * deterministas/unit-testables y evitar mismatch de hidratación.
 *
 * ⚠️ NO consume ni reimplementa el motor de rateio/despacho/costo (G-09): sólo
 * proyecta campos EXISTENTES en señales de display. `costoTotal` (landed) NUNCA
 * se deriva acá — se gatea en el read por permiso.
 */

import type { EmbarqueCostoEstado, EmbarqueEstado } from "@/generated/prisma/client";
import { convertirMonto } from "@/lib/format";

const MS_DIA = 86_400_000;
const ETA_PROXIMO_DIAS = 7;
const PROXIMOS_ARRIBOS_DIAS = 15;

/** Tono semántico (espelha o vocabulário do `StatusBadge` / PR-001). */
export type Tono = "neutral" | "process" | "info" | "success" | "warning" | "danger";
export type EtaTono = "overdue" | "soon" | "none";
/** Best-effort: el spec pide 5 tiers; `Pagado` no es derivable sin datos de pago. */
export type StatusCostoUi = "Estimado" | "Provisionado" | "Facturado" | "Cerrado";
export type StatusPagoUi = "al_dia" | "vencido";

/** Proyección estrecha de EmbarqueCosto — SIN campos monetarios (anti-leak). */
export type CostoLite = {
  estado: EmbarqueCostoEstado;
  fechaVencimiento: Date | null;
};

const ESTADOS_TERMINALES: ReadonlySet<EmbarqueEstado> = new Set<EmbarqueEstado>([
  "DESPACHADO",
  "EN_DEPOSITO",
  "CERRADO",
]);

/** ETA: âmbar < 7d, vermelho vencido; sem cor em estado terminal ou ETA nula. */
export function deriveEtaTono(
  fechaLlegada: Date | null,
  estado: EmbarqueEstado,
  now: Date,
): EtaTono {
  if (!fechaLlegada || ESTADOS_TERMINALES.has(estado)) return "none";
  const diff = fechaLlegada.getTime() - now.getTime();
  if (diff < 0) return "overdue";
  if (diff < ETA_PROXIMO_DIAS * MS_DIA) return "soon";
  return "none";
}

/** Valor comercial siempre en USD; ARS-nativo ÷ TC del propio embarque (display puro). */
export function fobEnUsd(fobTotal: string, moneda: "ARS" | "USD", tipoCambio: string): string {
  return moneda === "USD" ? fobTotal : convertirMonto(fobTotal, "ARS", "USD", tipoCambio);
}

function hayEmitidaVencida(costos: CostoLite[], now: Date): boolean {
  return costos.some(
    (c) =>
      c.estado === "EMITIDA" &&
      c.fechaVencimiento != null &&
      c.fechaVencimiento.getTime() < now.getTime(),
  );
}

/**
 * Status pago de GASTOS LOCALES (best-effort). Sólo mira facturas locales
 * EMITIDA; NO refleja la deuda exterior FOB ni pagos parciales (aplicaciones).
 */
export function deriveStatusPago(costos: CostoLite[], now: Date): StatusPagoUi | null {
  const emitidas = costos.filter((c) => c.estado === "EMITIDA");
  if (emitidas.length === 0) return null;
  return hayEmitidaVencida(emitidas, now) ? "vencido" : "al_dia";
}

/** Bloqueo derivable read-only: único caso confiable = factura local vencida. */
export function deriveBloqueo(costos: CostoLite[], now: Date): string | null {
  return hayEmitidaVencida(costos, now) ? "Pago local vencido" : null;
}

/** Status costo best-effort (4 de 5 tiers; `Pagado` no derivable sin datos de pago). */
export function deriveStatusCosto(costos: CostoLite[], estado: EmbarqueEstado): StatusCostoUi {
  if (estado === "CERRADO") return "Cerrado";
  if (costos.some((c) => c.estado === "EMITIDA")) return "Facturado";
  if (costos.some((c) => c.estado === "BORRADOR")) return "Provisionado";
  return "Estimado";
}

const TONO_CONTENEDOR: Record<string, Tono> = {
  BORRADOR: "neutral",
  EN_TRANSITO: "warning",
  ARRIBADO_PUERTO: "warning",
  EN_ZONA_PRIMARIA: "warning",
  TRASLADO_DEPOSITO_FISCAL: "warning",
  EN_DEPOSITO_FISCAL: "process",
  AGUARDANDO_INVESTIGACAO: "danger",
  DESCONSOLIDADO: "process",
  PARCIALMENTE_DESPACHADO: "info",
  TOTALMENTE_DESPACHADO: "success",
  NACIONALIZADO_DIRECTO: "success",
  CANCELADO: "danger",
};

/** Tono por cada uno de los 12 `ContenedorEstado` (token desconocido → neutral). */
export function tonoContenedor(estado: string): Tono {
  return TONO_CONTENEDOR[estado] ?? "neutral";
}

export const TONO_STATUS_COSTO: Record<StatusCostoUi, Tono> = {
  Estimado: "neutral",
  Provisionado: "warning",
  Facturado: "info",
  Cerrado: "success",
};

export const TONO_STATUS_PAGO: Record<StatusPagoUi, Tono> = {
  al_dia: "success",
  vencido: "danger",
};

export const STATUS_PAGO_LABEL: Record<StatusPagoUi, string> = {
  al_dia: "Al día (local)",
  vencido: "Vencido (local)",
};

// ── Vistas canónicas (server-driven en URL) ────────────────────────────────
export type VistaId =
  | "todos"
  | "transito"
  | "puerto"
  | "finalizados"
  | "borradores"
  | "proximos"
  | "documentos"
  | "cancelados";

export type VistaDef = { id: VistaId; label: string; disabled?: boolean; hint?: string };

/** Vistas oficiais; as desabilitadas exigem dado/estado inexistente (Fase 1). */
export const VISTAS: readonly VistaDef[] = [
  { id: "todos", label: "Todos" },
  { id: "transito", label: "En tránsito" },
  { id: "puerto", label: "En puerto" },
  { id: "finalizados", label: "Finalizados" },
  { id: "borradores", label: "Borradores" },
  { id: "proximos", label: "Próximos arribos" },
  {
    id: "documentos",
    label: "Documentos pendientes",
    disabled: true,
    hint: "sin modelo de documentos (Fase 1)",
  },
  {
    id: "cancelados",
    label: "Cancelados",
    disabled: true,
    hint: "sin estado Cancelado en el schema (Fase 1)",
  },
];

const ESTADOS_VISTA: Partial<Record<VistaId, EmbarqueEstado[]>> = {
  transito: ["EN_TRANSITO"],
  puerto: ["EN_PUERTO", "EN_ZONA_PRIMARIA", "EN_ADUANA"],
  finalizados: ["DESPACHADO", "EN_DEPOSITO", "CERRADO"],
  borradores: ["BORRADOR"],
};

/** Normaliza `?vista` a una vista activa válida (desconocida/deshabilitada → todos). */
export function parseVista(v: string | undefined): VistaId {
  const found = VISTAS.find((x) => x.id === v && !x.disabled);
  return found ? found.id : "todos";
}

/** Traduce una vista a un filtro de LECTURA (estado set y/o ETA ≤ 15d). */
export function resolverVistaFiltro(
  vista: VistaId,
  now: Date,
): { estado?: EmbarqueEstado[]; etaHasta?: Date } {
  if (vista === "proximos") {
    return { etaHasta: new Date(now.getTime() + PROXIMOS_ARRIBOS_DIAS * MS_DIA) };
  }
  const estado = ESTADOS_VISTA[vista];
  return estado ? { estado } : {};
}
