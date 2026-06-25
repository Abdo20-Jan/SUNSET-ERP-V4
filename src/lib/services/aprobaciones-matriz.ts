// Matriz de aprobación (ANEXO A.3) + SLA (ANEXO B) + régua de escalonamiento
// (AUTO-01) como CONFIG tipada y data-driven (PR-012). Fuente de verdad del
// motor de aprobaciones: qué clave de permiso autoriza cada tipo, si exige
// dupla aprobación, el SLA en horas y la cadena de tiers de escalonamiento.
//
// PURO (sin `server-only`): lo importan el motor (server), los tests y, a
// futuro, la UI/seed para reflejar la matriz. Referencia SIEMPRE claves
// simbólicas del catálogo (PERMISOS.X), nunca literales ni `Role` hardcodeado.
//
// Mapeo perfil→clave (ANEXO A.3) — quién DEBERÍA tener cada clave, para la
// asignación posterior por la UI de PR-009 (los perfiles canónicos nacen
// vacíos en PR-006). Master = perfil ADMIN (override 🔒 sobre todo tipo):
//   clienteBloqueado .......... Diretor, Financeiro
//   margenBaja5 ............... Diretor, Comercial gestor
//   margenBaja10 ............. Diretor
//   margenBajaMayor10 ........ Diretor (dupla), Comercial gestor (dupla)
//   limiteExcedido20 ......... Diretor, Financeiro
//   limiteExcedidoMayor20 .... Diretor (dupla), Financeiro (dupla)
//   plazoEspecial ............ Diretor, Financeiro
//   descuentoEspecial10 ...... Diretor, Comercial gestor
//   pagoNormal ............... Diretor, Financeiro
//   pagoAltoValor ............ Diretor (dupla), Financeiro (dupla)
//   costoComexMayor10 ........ Diretor, Financeiro, Comex (solicitar)
//   ajusteStock5 ............. Diretor, Estoque gestor
//   ajusteStockMayor5 ........ Diretor (dupla), Estoque gestor (dupla)
//   reaperturaCostoComex ..... Diretor (dupla), Financeiro (dupla), Comex
//   reaperturaPeriodoContable  Diretor, Contabilidade (solicitar)
//   lanzamientoManualContable  Diretor, Contabilidade
//   anularVentaFacturada ..... Diretor, Comercial gestor
//   cancelarProcesoComex ..... Diretor, Comex gestor

import type { TipoAprobacion as TipoAprobacionValue } from "@/generated/prisma/enums";
import { TipoAprobacion } from "@/generated/prisma/enums";
import { type PermisoKey, PERMISOS } from "@/lib/permisos-catalog";

/** Configuración de un tipo de aprobación (una fila de la matriz ANEXO A.3). */
export interface TipoAprobacionConfig {
  tipo: TipoAprobacionValue;
  /** Clave de permiso que autoriza aprobar este tipo (gate del motor). */
  permisoAprobacion: PermisoKey;
  /** SLA en horas (ANEXO B). */
  slaHoras: number;
  /** true = exige dos aprobadores DISTINTOS (dupla aprobación). */
  requiereDupla: boolean;
  /** Tiers de escalonamiento tras el aprobador base, en orden (régua AUTO-01). */
  escalonamiento: readonly PermisoKey[];
  /**
   * Si true, al agotar el escalonamiento el motor auto-aprueba con Master
   * override. Default false (decisión del dono): el terminal es EXPIRADA y el
   * Master override queda como acción MANUAL explícita.
   */
  autoMasterOverride: boolean;
}

/** Cadena de escalonamiento por defecto: base → Diretor → Master. */
export const ESCALONAMIENTO_DEFAULT: readonly PermisoKey[] = [
  PERMISOS.APROBAR_ESCALAR_DIRECTOR,
  PERMISOS.APROBAR_MASTER_OVERRIDE,
];

/** Constructor compacto de una fila (escalonamiento default, sin auto-override). */
function cfg(
  tipo: TipoAprobacionValue,
  permisoAprobacion: PermisoKey,
  slaHoras: number,
  requiereDupla = false,
): TipoAprobacionConfig {
  return {
    tipo,
    permisoAprobacion,
    slaHoras,
    requiereDupla,
    escalonamiento: ESCALONAMIENTO_DEFAULT,
    autoMasterOverride: false,
  };
}

/**
 * La matriz completa: una entrada por cada `TipoAprobacion`. SLA por ANEXO B;
 * `requiereDupla` true sólo en las 5 franjas marcadas "(dupla)" en ANEXO A.3.
 */
export const MATRIZ_APROBACION: Record<TipoAprobacionValue, TipoAprobacionConfig> = {
  [TipoAprobacion.CLIENTE_BLOQUEADO]: cfg(
    TipoAprobacion.CLIENTE_BLOQUEADO,
    PERMISOS.APROBAR_CLIENTE_BLOQUEADO,
    24,
  ),
  [TipoAprobacion.MARGEN_BAJA_5]: cfg(
    TipoAprobacion.MARGEN_BAJA_5,
    PERMISOS.APROBAR_MARGEN_BAJA_5,
    48,
  ),
  [TipoAprobacion.MARGEN_BAJA_10]: cfg(
    TipoAprobacion.MARGEN_BAJA_10,
    PERMISOS.APROBAR_MARGEN_BAJA_10,
    48,
  ),
  [TipoAprobacion.MARGEN_BAJA_MAYOR_10]: cfg(
    TipoAprobacion.MARGEN_BAJA_MAYOR_10,
    PERMISOS.APROBAR_MARGEN_BAJA_MAYOR_10,
    48,
    true,
  ),
  [TipoAprobacion.LIMITE_EXCEDIDO_20]: cfg(
    TipoAprobacion.LIMITE_EXCEDIDO_20,
    PERMISOS.APROBAR_LIMITE_EXCEDIDO_20,
    48,
  ),
  [TipoAprobacion.LIMITE_EXCEDIDO_MAYOR_20]: cfg(
    TipoAprobacion.LIMITE_EXCEDIDO_MAYOR_20,
    PERMISOS.APROBAR_LIMITE_EXCEDIDO_MAYOR_20,
    48,
    true,
  ),
  [TipoAprobacion.PLAZO_ESPECIAL]: cfg(
    TipoAprobacion.PLAZO_ESPECIAL,
    PERMISOS.APROBAR_PLAZO_ESPECIAL,
    48,
  ),
  [TipoAprobacion.DESCUENTO_ESPECIAL_10]: cfg(
    TipoAprobacion.DESCUENTO_ESPECIAL_10,
    PERMISOS.APROBAR_DESCUENTO_ESPECIAL_10,
    48,
  ),
  [TipoAprobacion.PAGO_NORMAL]: cfg(TipoAprobacion.PAGO_NORMAL, PERMISOS.APROBAR_PAGO_NORMAL, 72),
  [TipoAprobacion.PAGO_ALTO_VALOR]: cfg(
    TipoAprobacion.PAGO_ALTO_VALOR,
    PERMISOS.APROBAR_PAGO_ALTO_VALOR,
    4,
    true,
  ),
  [TipoAprobacion.COSTO_COMEX_MAYOR_10]: cfg(
    TipoAprobacion.COSTO_COMEX_MAYOR_10,
    PERMISOS.APROBAR_COSTO_COMEX_MAYOR_10,
    48,
  ),
  [TipoAprobacion.AJUSTE_STOCK_5]: cfg(
    TipoAprobacion.AJUSTE_STOCK_5,
    PERMISOS.APROBAR_AJUSTE_STOCK_5,
    24,
  ),
  [TipoAprobacion.AJUSTE_STOCK_MAYOR_5]: cfg(
    TipoAprobacion.AJUSTE_STOCK_MAYOR_5,
    PERMISOS.APROBAR_AJUSTE_STOCK_MAYOR_5,
    24,
    true,
  ),
  [TipoAprobacion.REAPERTURA_COSTO_COMEX]: cfg(
    TipoAprobacion.REAPERTURA_COSTO_COMEX,
    PERMISOS.APROBAR_REAPERTURA_COSTO_COMEX,
    24,
    true,
  ),
  [TipoAprobacion.REAPERTURA_PERIODO_CONTABLE]: cfg(
    TipoAprobacion.REAPERTURA_PERIODO_CONTABLE,
    PERMISOS.APROBAR_REAPERTURA_PERIODO_CONTABLE,
    24,
  ),
  [TipoAprobacion.LANZAMIENTO_MANUAL_CONTABLE]: cfg(
    TipoAprobacion.LANZAMIENTO_MANUAL_CONTABLE,
    PERMISOS.APROBAR_LANZAMIENTO_MANUAL_CONTABLE,
    24,
  ),
  [TipoAprobacion.ANULAR_VENTA_FACTURADA]: cfg(
    TipoAprobacion.ANULAR_VENTA_FACTURADA,
    PERMISOS.APROBAR_ANULAR_VENTA_FACTURADA,
    48,
  ),
  [TipoAprobacion.CANCELAR_PROCESO_COMEX]: cfg(
    TipoAprobacion.CANCELAR_PROCESO_COMEX,
    PERMISOS.APROBAR_CANCELAR_PROCESO_COMEX,
    48,
  ),
};

/** Devuelve la configuración de un tipo (lanza si falta — invariante del enum). */
export function getConfigAprobacion(tipo: TipoAprobacionValue): TipoAprobacionConfig {
  const c = MATRIZ_APROBACION[tipo];
  if (!c) throw new Error(`Tipo de aprobación sin configuración en la matriz: ${tipo}`);
  return c;
}
