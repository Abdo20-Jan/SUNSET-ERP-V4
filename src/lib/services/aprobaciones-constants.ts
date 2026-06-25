// Constantes de presentación de la Central de Aprobaciones (AUTO-01 / PR-013).
// PURO y client-safe (sin `server-only`): lo importan la worklist, las columnas
// y la filter-bar (client) además de la query (server). Sólo labels/presets —
// la lógica del motor vive en PR-012 y NO se toca acá.

import { EstadoSolicitud, TipoAprobacion } from "@/generated/prisma/enums";
import type { BandaSla } from "./aprobaciones-helpers";

// ── Tipos de aprobación (ANEXO A.3) ──────────────────────────────────────────

export const TIPO_LABEL: Record<TipoAprobacion, string> = {
  [TipoAprobacion.CLIENTE_BLOQUEADO]: "Cliente bloqueado",
  [TipoAprobacion.MARGEN_BAJA_5]: "Margen bajo (hasta -5%)",
  [TipoAprobacion.MARGEN_BAJA_10]: "Margen bajo (-5% a -10%)",
  [TipoAprobacion.MARGEN_BAJA_MAYOR_10]: "Margen bajo (< -10%)",
  [TipoAprobacion.LIMITE_EXCEDIDO_20]: "Límite excedido (hasta +20%)",
  [TipoAprobacion.LIMITE_EXCEDIDO_MAYOR_20]: "Límite excedido (> +20%)",
  [TipoAprobacion.PLAZO_ESPECIAL]: "Plazo especial",
  [TipoAprobacion.DESCUENTO_ESPECIAL_10]: "Descuento especial (hasta -10%)",
  [TipoAprobacion.PAGO_NORMAL]: "Pago normal",
  [TipoAprobacion.PAGO_ALTO_VALOR]: "Pago alto valor / urgente",
  [TipoAprobacion.COSTO_COMEX_MAYOR_10]: "Costo Comex (> +10%)",
  [TipoAprobacion.AJUSTE_STOCK_5]: "Ajuste de stock (hasta 5%)",
  [TipoAprobacion.AJUSTE_STOCK_MAYOR_5]: "Ajuste de stock (> 5%)",
  [TipoAprobacion.REAPERTURA_COSTO_COMEX]: "Reapertura costo Comex",
  [TipoAprobacion.REAPERTURA_PERIODO_CONTABLE]: "Reapertura período contable",
  [TipoAprobacion.LANZAMIENTO_MANUAL_CONTABLE]: "Lanzamiento manual contable",
  [TipoAprobacion.ANULAR_VENTA_FACTURADA]: "Anular venta facturada",
  [TipoAprobacion.CANCELAR_PROCESO_COMEX]: "Cancelar proceso Comex",
};

export const TIPO_VALUES: readonly TipoAprobacion[] = Object.values(TipoAprobacion);

export function tipoLabel(tipo: TipoAprobacion): string {
  return TIPO_LABEL[tipo] ?? tipo;
}

/** Subconjunto relevante a una Venta (piloto COM-05 / PR-013). */
export const TIPOS_VENTA: readonly TipoAprobacion[] = [
  TipoAprobacion.CLIENTE_BLOQUEADO,
  TipoAprobacion.MARGEN_BAJA_5,
  TipoAprobacion.MARGEN_BAJA_10,
  TipoAprobacion.MARGEN_BAJA_MAYOR_10,
  TipoAprobacion.LIMITE_EXCEDIDO_20,
  TipoAprobacion.LIMITE_EXCEDIDO_MAYOR_20,
  TipoAprobacion.PLAZO_ESPECIAL,
  TipoAprobacion.DESCUENTO_ESPECIAL_10,
  TipoAprobacion.ANULAR_VENTA_FACTURADA,
];

// ── Estados (6 canónicos AUTO-01 §4) ─────────────────────────────────────────

export const ESTADO_LABEL: Record<EstadoSolicitud, string> = {
  [EstadoSolicitud.PENDIENTE]: "Pendiente",
  [EstadoSolicitud.APROBADA]: "Aprobada",
  [EstadoSolicitud.RECHAZADA]: "Rechazada",
  [EstadoSolicitud.EXPIRADA]: "Expirada",
  [EstadoSolicitud.CANCELADA]: "Cancelada",
  [EstadoSolicitud.SOLICITANDO_INFO]: "Solicitando info",
};

export const ESTADO_VALUES: readonly EstadoSolicitud[] = Object.values(EstadoSolicitud);

export function estadoLabel(estado: EstadoSolicitud): string {
  return ESTADO_LABEL[estado] ?? estado;
}

/** Estados abiertos (en cola): el motor sólo transiciona desde estos. */
export const ESTADOS_ABIERTOS: readonly EstadoSolicitud[] = [
  EstadoSolicitud.PENDIENTE,
  EstadoSolicitud.SOLICITANDO_INFO,
];

// ── SLA (régua AUTO-01): banda 50/75 = âmbar · 100 = vermelho ─────────────────

export const SLA_BANDA_LABEL: Record<BandaSla, string> = {
  0: "En plazo",
  50: "50% SLA",
  75: "75% SLA",
  100: "Vencido",
};

/** Clase de color por banda de SLA (design tokens). */
export const SLA_BANDA_CLASS: Record<BandaSla, string> = {
  0: "text-muted-foreground",
  50: "text-warning",
  75: "text-warning",
  100: "text-destructive font-semibold",
};

// ── Sub-vistas oficiales (presets de `?vista=`, server-driven) ────────────────

export type SubvistaId = "pendientes" | "mis-pendientes" | "por-vencer" | "resueltas" | "todos";

export const SUBVISTAS: readonly { id: SubvistaId; label: string }[] = [
  { id: "pendientes", label: "Pendientes" },
  { id: "mis-pendientes", label: "Mis pendientes" },
  { id: "por-vencer", label: "Por vencer (SLA)" },
  { id: "resueltas", label: "Resueltas" },
  { id: "todos", label: "Todas" },
];

export const SUBVISTA_DEFAULT: SubvistaId = "pendientes";
