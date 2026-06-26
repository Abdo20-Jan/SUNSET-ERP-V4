// Faixas de margem baixa (CRIT-03 / 08_SALES_MARGIN_RULES) como CONFIG tipada y
// data-driven (PR-014). Mapea el margen neto % de una venta al TipoAprobacion
// requerido. PURO y client-safe (SIN `server-only`): lo importan el gate (server),
// los tests y el `venta-form` (client) para semear el tipo correcto al solicitar.
//
// El cálculo del margen ESPELHA `venta-form.tsx` (useMemo `totals`) — NO recalcula
// con criterio propio ni toca el motor de asiento. Usa `decimal.js` directo (igual
// que el form), no `@/lib/decimal` (que importa Prisma y no es client-safe).
//
// Límite de banda: el tier MÁS severo posee el borde (−5,00 ⇒ BAJA_10; −10,00 ⇒
// MAYOR_10; −15,00 ⇒ MAYOR_10). El piso es 0% (sólo margen NEGATIVO dispara).
// El tier <−15%/negativa colapsa en MARGEN_BAJA_MAYOR_10 (no hay 4º enum sin
// schema); `requiereMaster` es METADATO DOCUMENTAL — el gate NO lo enforce.

import Decimal from "decimal.js";

import { TipoAprobacion } from "@/generated/prisma/enums";

/** Piso de margen neto (%). Sólo margen estrictamente menor dispara aprobación. */
export const PISO_MARGEN_PCT = 0;

/** Provisión Ganancias (35%) — sólo se aplica si la utilidad bruta es positiva. */
const PROVISION_GANANCIAS = 0.35;

export type FaixaMargen = {
  tipo: TipoAprobacion;
  /** Doc-only: el spec exige Master para <−15%; el motor no lo enforce (sin 4º tipo). */
  requiereMaster: boolean;
};

// Bandas evaluadas de la MÁS severa a la menos severa: el borde pertenece al tier
// más severo (`pct <= limiteSuperior`). La última (limiteSuperior 0) captura
// (−5, 0) ⇒ BAJA_5; sólo se llega acá con pct < 0 (el piso se chequea antes).
const FAIXAS: readonly { limiteSuperior: number; tipo: TipoAprobacion; requiereMaster: boolean }[] =
  [
    { limiteSuperior: -15, tipo: TipoAprobacion.MARGEN_BAJA_MAYOR_10, requiereMaster: true },
    { limiteSuperior: -10, tipo: TipoAprobacion.MARGEN_BAJA_MAYOR_10, requiereMaster: false },
    { limiteSuperior: -5, tipo: TipoAprobacion.MARGEN_BAJA_10, requiereMaster: false },
    { limiteSuperior: 0, tipo: TipoAprobacion.MARGEN_BAJA_5, requiereMaster: false },
  ];

/** Resuelve la faixa de aprobación para un margen neto %; null si está sobre el piso. */
export function resolverFaixaMargen(margenPct: Decimal | number | string): FaixaMargen | null {
  const pct = new Decimal(margenPct);
  if (pct.gte(PISO_MARGEN_PCT)) return null;
  for (const f of FAIXAS) {
    if (pct.lte(f.limiteSuperior)) return { tipo: f.tipo, requiereMaster: f.requiereMaster };
  }
  // Inalcanzable: la última banda (limiteSuperior 0) siempre matchea con pct < 0.
  return { tipo: TipoAprobacion.MARGEN_BAJA_5, requiereMaster: false };
}

// Severidad ascendente de los tipos de margen baja (para el match por conjunto).
const SEVERIDAD_MARGEN: readonly TipoAprobacion[] = [
  TipoAprobacion.MARGEN_BAJA_5,
  TipoAprobacion.MARGEN_BAJA_10,
  TipoAprobacion.MARGEN_BAJA_MAYOR_10,
];

/**
 * Tipos que SATISFACEN un requerimiento de `tipo`: el exigido y todos los más
 * severos. Aprobar un tier peor cubre una necesidad menor; sub-aprobar bloquea.
 */
export function tiposMargenAlMenos(tipo: TipoAprobacion): TipoAprobacion[] {
  const idx = SEVERIDAD_MARGEN.indexOf(tipo);
  if (idx < 0) return [tipo];
  return SEVERIDAD_MARGEN.slice(idx);
}

/** Suma del costo de los items SIN redondeo intermedio (igual que el form). */
export function sumarCostoItems(
  items: readonly { cantidad: number; costoPromedio: Decimal | number | string }[],
): Decimal {
  return items.reduce<Decimal>(
    (acc, it) => acc.plus(new Decimal(it.costoPromedio).times(it.cantidad)),
    new Decimal(0),
  );
}

/**
 * Margen neto % de una venta, ESPELHANDO `venta-form.tsx`:
 *   bruta = subtotal − costoTotal − flete − percepcionIIBB   (costoTotal SIN redondear)
 *   provisión = bruta>0 ? bruta×0.35 (2dp) : 0
 *   neta = bruta − provisión
 *   margenNetoPct = subtotal>0 ? neta/subtotal×100 (2dp) : 0
 */
export function calcularMargenNetoVenta(args: {
  subtotal: Decimal | number | string;
  costoTotal: Decimal | number | string;
  flete: Decimal | number | string;
  percepcionIIBB: Decimal | number | string;
}): Decimal {
  const subtotal = new Decimal(args.subtotal);
  const utilidadBruta = subtotal
    .minus(new Decimal(args.costoTotal))
    .minus(new Decimal(args.flete))
    .minus(new Decimal(args.percepcionIIBB));
  const provision = utilidadBruta.gt(0)
    ? utilidadBruta.times(PROVISION_GANANCIAS).toDecimalPlaces(2)
    : new Decimal(0);
  const utilidadNeta = utilidadBruta.minus(provision);
  return subtotal.gt(0)
    ? utilidadNeta.dividedBy(subtotal).times(100).toDecimalPlaces(2)
    : new Decimal(0);
}
