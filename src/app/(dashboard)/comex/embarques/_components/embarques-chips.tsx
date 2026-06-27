"use client";

/**
 * Chips de display de la worklist Comex (PR-020 / CX-02). Componentes puros de
 * presentación: `TonoChip` (badge tonal genérico para status derivados) y
 * `ContainerChip` (nº de contenedor + estado, con tono semántico por estado).
 *
 * Reusa el vocabulario de tonos del PR-001 (mismo mapa que `StatusBadge`) sin
 * modificar el componente compartido — los tokens derivados (Provisionado/
 * Facturado/al_dia/…) y los 12 `ContenedorEstado` no están en el mapa de
 * `StatusBadge`, así que se tonalizan acá localmente.
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

/** Etiquetas cortas de cada `ContenedorEstado` para el chip. */
const CONTENEDOR_LABEL: Record<string, string> = {
  BORRADOR: "Borrador",
  EN_TRANSITO: "Tránsito",
  ARRIBADO_PUERTO: "Arribado",
  EN_ZONA_PRIMARIA: "Zona prim.",
  TRASLADO_DEPOSITO_FISCAL: "Traslado DF",
  EN_DEPOSITO_FISCAL: "Dep. fiscal",
  AGUARDANDO_INVESTIGACAO: "Investig.",
  DESCONSOLIDADO: "Desconsol.",
  PARCIALMENTE_DESPACHADO: "Parcial",
  TOTALMENTE_DESPACHADO: "Despachado",
  NACIONALIZADO_DIRECTO: "Nac. directo",
  CANCELADO: "Cancelado",
};

/** Chip de contenedor: nº truncado + estado, con tono semántico. Display-only. */
export function ContainerChip({ numero, estado }: { numero: string; estado: string }) {
  const label = CONTENEDOR_LABEL[estado] ?? estado;
  return (
    <span
      className={cn(CHIP_BASE, TONO_CLASS[tonoContenedor(estado)], "max-w-[160px]")}
      title={`${numero} · ${label}`}
    >
      <span className="truncate font-mono">{numero}</span>
      <span className="opacity-70">· {label}</span>
    </span>
  );
}
