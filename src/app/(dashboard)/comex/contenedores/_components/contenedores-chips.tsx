"use client";

/**
 * Chips de display de la worklist GLOBAL de contenedores (PR-024 / CX-04).
 * Presentación pura. Reusa el vocabulario de tonos del PR-001 y el mapa
 * `tonoContenedor` (los 12 `ContenedorEstado` no están en el `StatusBadge`
 * compartido, así que se tonalizan acá — mismo patrón que `embarques-chips`).
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { type Tono, tonoContenedor } from "@/lib/services/comex-worklist-derivaciones";

const TONO_CLASS: Record<Tono, string> = {
  neutral: "bg-muted text-muted-foreground border-border/60",
  process: "bg-process/12 text-process border-process/25",
  info: "bg-info/12 text-info border-info/25",
  success: "bg-success/12 text-success border-success/25",
  warning: "bg-warning/15 text-warning border-warning/30",
  danger: "bg-destructive/10 text-destructive border-destructive/25",
};

const CHIP_BASE =
  "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] leading-none font-medium";

export function TonoChip({ tono, children }: { tono: Tono; children: ReactNode }) {
  return <span className={cn(CHIP_BASE, TONO_CLASS[tono])}>{children}</span>;
}

/** Etiquetas legibles de cada `ContenedorEstado`. */
export const CONTENEDOR_LABEL: Record<string, string> = {
  BORRADOR: "Borrador",
  EN_TRANSITO: "En tránsito",
  ARRIBADO_PUERTO: "Arribado",
  EN_ZONA_PRIMARIA: "Zona primaria",
  TRASLADO_DEPOSITO_FISCAL: "Traslado a DF",
  EN_DEPOSITO_FISCAL: "En depósito fiscal",
  AGUARDANDO_INVESTIGACAO: "En investigación",
  DESCONSOLIDADO: "Desconsolidado",
  PARCIALMENTE_DESPACHADO: "Parcialmente despachado",
  TOTALMENTE_DESPACHADO: "Totalmente despachado",
  NACIONALIZADO_DIRECTO: "Nacionalizado directo",
  CANCELADO: "Cancelado",
};

/** Badge de estado del contenedor con tono semántico (display-only). */
export function EstadoContenedorBadge({ estado }: { estado: string }) {
  return <TonoChip tono={tonoContenedor(estado)}>{CONTENEDOR_LABEL[estado] ?? estado}</TonoChip>;
}
