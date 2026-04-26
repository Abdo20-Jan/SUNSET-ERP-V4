import "server-only";

import {
  CuentaCategoria,
  CuentaTipo,
  Prisma,
} from "@/generated/prisma/client";

type TxClient = Omit<
  Prisma.TransactionClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

// ============================================================
// getOrCreateCuenta — núcleo del auto-plan-de-cuentas
// ============================================================

export type CuentaDef = {
  codigo: string;
  nombre: string;
  categoria: CuentaCategoria;
  /** Si no se pasa, se deriva del codigo (todo lo previo al último ".") */
  padreCodigo?: string;
  /** Si no se pasa, se deriva contando segmentos del codigo. */
  nivel?: number;
};

function derivePadreCodigo(codigo: string): string | null {
  const i = codigo.lastIndexOf(".");
  return i === -1 ? null : codigo.slice(0, i);
}

function deriveNivel(codigo: string): number {
  return codigo.split(".").length;
}

/**
 * Devuelve el id de la cuenta con el código dado; si no existe la crea
 * como ANALITICA. Idempotente — útil para asiento generators que ya no
 * dependen de un seed pre-poblado.
 */
export async function getOrCreateCuenta(
  tx: TxClient,
  def: CuentaDef,
): Promise<number> {
  const existing = await tx.cuentaContable.findUnique({
    where: { codigo: def.codigo },
    select: { id: true, activa: true },
  });
  if (existing) return existing.id;

  const padreCodigo = def.padreCodigo ?? derivePadreCodigo(def.codigo);
  const nivel = def.nivel ?? deriveNivel(def.codigo);
  const created = await tx.cuentaContable.create({
    data: {
      codigo: def.codigo,
      nombre: def.nombre,
      tipo: CuentaTipo.ANALITICA,
      categoria: def.categoria,
      nivel,
      padreCodigo,
      activa: true,
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Resuelve un mapa { key → CuentaDef } a un mapa { codigo → id },
 * creando lazy las cuentas que no existen. Mantiene la API existente
 * de los asiento generators.
 */
export async function ensureCuentasMap<T extends Record<string, CuentaDef>>(
  tx: TxClient,
  registry: T,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const def of Object.values(registry)) {
    if (out.has(def.codigo)) continue;
    const id = await getOrCreateCuenta(tx, def);
    out.set(def.codigo, id);
  }
  return out;
}

// ============================================================
// Auto-creación de cuentas individuales — numeración automática
// en rangos por categoría / tipo de entidad
// ============================================================

import type { TipoCanal, TipoProveedor } from "@/generated/prisma/client";

/**
 * Rangos de auto-creación. Códigos `.01-.09` quedan reservados
 * para cuentas genéricas creadas manualmente o por seed.
 *
 * Cliente: por canal (`tipoCanal`).
 * Proveedor: por tipo (`tipoProveedor`). Extranjeros viven en
 * `2.1.8 PROVEEDORES DEL EXTERIOR` (sintetica nueva, separada
 * de `2.1.1 DEUDAS COMERCIALES`).
 */
const RANGES = {
  // Cliente — por canal
  CLIENTE_MAYORISTA:          { padre: "1.1.3", min: 10, max: 19, categoria: CuentaCategoria.ACTIVO },
  CLIENTE_MINORISTA:          { padre: "1.1.3", min: 20, max: 29, categoria: CuentaCategoria.ACTIVO },
  CLIENTE_REVENDEDOR_GOMERIA: { padre: "1.1.3", min: 30, max: 39, categoria: CuentaCategoria.ACTIVO },
  CLIENTE_TRANSPORTISTA:      { padre: "1.1.3", min: 40, max: 49, categoria: CuentaCategoria.ACTIVO },
  CLIENTE_GRANDE_CUENTA:      { padre: "1.1.3", min: 50, max: 59, categoria: CuentaCategoria.ACTIVO },
  CLIENTE_EXTERIOR:           { padre: "1.1.3", min: 60, max: 69, categoria: CuentaCategoria.ACTIVO },
  CLIENTE_CONSUMIDOR_FINAL:   { padre: "1.1.3", min: 99, max: 99, categoria: CuentaCategoria.ACTIVO },

  // Proveedor nacional — por tipo, bajo 2.1.1
  PROVEEDOR_MERCADERIA_LOCAL:    { padre: "2.1.1", min: 10, max: 14, categoria: CuentaCategoria.PASIVO },
  PROVEEDOR_DESPACHANTE:         { padre: "2.1.1", min: 15, max: 19, categoria: CuentaCategoria.PASIVO },
  PROVEEDOR_LOGISTICA:           { padre: "2.1.1", min: 20, max: 24, categoria: CuentaCategoria.PASIVO },
  PROVEEDOR_ALMACENAJE:          { padre: "2.1.1", min: 25, max: 29, categoria: CuentaCategoria.PASIVO },
  PROVEEDOR_SERVICIOS_PROFESIONALES: { padre: "2.1.1", min: 30, max: 34, categoria: CuentaCategoria.PASIVO },
  PROVEEDOR_ALQUILERES:          { padre: "2.1.1", min: 35, max: 39, categoria: CuentaCategoria.PASIVO },
  PROVEEDOR_IT_SOFTWARE:         { padre: "2.1.1", min: 40, max: 44, categoria: CuentaCategoria.PASIVO },
  PROVEEDOR_GASTOS_PORTUARIOS:   { padre: "2.1.1", min: 45, max: 49, categoria: CuentaCategoria.PASIVO },
  PROVEEDOR_MARKETING:           { padre: "2.1.1", min: 50, max: 54, categoria: CuentaCategoria.PASIVO },
  PROVEEDOR_OTRO:                { padre: "2.1.1", min: 55, max: 99, categoria: CuentaCategoria.PASIVO },

  // Proveedor extranjero — bajo 2.1.8 PROVEEDORES DEL EXTERIOR
  PROVEEDOR_MERCADERIA_EXTERIOR: { padre: "2.1.8", min: 10, max: 49, categoria: CuentaCategoria.PASIVO },
  PROVEEDOR_SERVICIOS_EXTERIOR:  { padre: "2.1.8", min: 50, max: 99, categoria: CuentaCategoria.PASIVO },

  // Cuenta de gasto/activo POR PROVEEDOR — contrapartida del DEBE en
  // facturas. Mismo principio que pasivos (un código por proveedor),
  // pero bajo el árbol de gastos (5.x.x.x).
  // MERCADERIA_LOCAL/EXTERIOR no se desagregan: van al stock compartido
  // 1.1.5.01 / 1.1.5.02 — el costo por proveedor se rastrea en stock.
  GASTO_DESPACHANTE:              { padre: "5.1.1", min: 10, max: 29, categoria: CuentaCategoria.EGRESO },
  GASTO_SERVICIOS_PROFESIONALES:  { padre: "5.1.1", min: 30, max: 49, categoria: CuentaCategoria.EGRESO },
  GASTO_ALQUILERES:               { padre: "5.2.1", min: 10, max: 29, categoria: CuentaCategoria.EGRESO },
  GASTO_IT_SOFTWARE:              { padre: "5.3.1", min: 10, max: 29, categoria: CuentaCategoria.EGRESO },
  GASTO_MARKETING:                { padre: "5.3.1", min: 30, max: 49, categoria: CuentaCategoria.EGRESO },
  GASTO_OTRO:                     { padre: "5.3.1", min: 50, max: 89, categoria: CuentaCategoria.EGRESO },
  GASTO_GASTOS_PORTUARIOS:        { padre: "5.4.1", min: 10, max: 29, categoria: CuentaCategoria.EGRESO },
  GASTO_LOGISTICA:                { padre: "5.5.1", min: 10, max: 19, categoria: CuentaCategoria.EGRESO },
  GASTO_ALMACENAJE:               { padre: "5.5.1", min: 20, max: 39, categoria: CuentaCategoria.EGRESO },
  GASTO_SERVICIOS_EXTERIOR:       { padre: "5.5.1", min: 40, max: 59, categoria: CuentaCategoria.EGRESO },

  // Bancos / cajas / préstamos — sin desagregación por tipo
  CAJA:        { padre: "1.1.1", min: 10, max: 99, categoria: CuentaCategoria.ACTIVO },
  BANCO:       { padre: "1.1.2", min: 10, max: 99, categoria: CuentaCategoria.ACTIVO },
  PRESTAMO_CP: { padre: "2.1.7", min: 10, max: 99, categoria: CuentaCategoria.PASIVO },
  PRESTAMO_LP: { padre: "2.2.1", min: 10, max: 99, categoria: CuentaCategoria.PASIVO },
} as const;

export type RangoCuentaAuto = keyof typeof RANGES;

function siguienteCodigo(
  existentes: string[],
  padre: string,
  min: number,
  max: number,
): string {
  const prefix = `${padre}.`;
  const usados = new Set<number>();
  for (const c of existentes) {
    if (!c.startsWith(prefix)) continue;
    const sufijo = c.slice(prefix.length);
    if (!/^\d+$/.test(sufijo)) continue;
    const n = parseInt(sufijo, 10);
    if (n >= min && n <= max) usados.add(n);
  }
  for (let n = min; n <= max; n++) {
    if (!usados.has(n)) return `${prefix}${String(n).padStart(2, "0")}`;
  }
  throw new Error(
    `No hay códigos disponibles en ${prefix}${min}-${max}. Cree la cuenta manualmente.`,
  );
}

/**
 * Crea una cuenta analítica para un proveedor/cliente. Devuelve el id.
 * Si ya existe el padre como SINTETICA queda como está; si existe pero
 * NO es SINTETICA (cargado en seed como ANALITICA fallback) lo dejamos
 * tal cual — la nueva cuenta hija no rompe nada porque Prisma no
 * fuerza coherencia padre/hijo en runtime; los reportes siguen
 * agregando por prefijo.
 */
export async function crearCuentaParaEntidad(
  tx: TxClient,
  rango: RangoCuentaAuto,
  nombre: string,
): Promise<{ id: number; codigo: string; nombre: string }> {
  const cfg = RANGES[rango];
  const existentes = await tx.cuentaContable.findMany({
    where: { codigo: { startsWith: `${cfg.padre}.` } },
    select: { codigo: true },
  });
  const codigo = siguienteCodigo(
    existentes.map((c) => c.codigo),
    cfg.padre,
    cfg.min,
    cfg.max,
  );
  const created = await tx.cuentaContable.create({
    data: {
      codigo,
      nombre: nombre.toUpperCase().slice(0, 80),
      tipo: CuentaTipo.ANALITICA,
      categoria: cfg.categoria,
      nivel: 4,
      padreCodigo: cfg.padre,
      activa: true,
    },
    select: { id: true, codigo: true, nombre: true },
  });
  return created;
}

/**
 * Mapeo desde el enum TipoProveedor al rango de cuenta correspondiente.
 * Garantiza coherencia entre maestro y plan de cuentas.
 */
export function rangoProveedorByTipo(tipo: TipoProveedor): RangoCuentaAuto {
  switch (tipo) {
    case "MERCADERIA_LOCAL":         return "PROVEEDOR_MERCADERIA_LOCAL";
    case "DESPACHANTE":              return "PROVEEDOR_DESPACHANTE";
    case "LOGISTICA":                return "PROVEEDOR_LOGISTICA";
    case "ALMACENAJE":               return "PROVEEDOR_ALMACENAJE";
    case "SERVICIOS_PROFESIONALES":  return "PROVEEDOR_SERVICIOS_PROFESIONALES";
    case "ALQUILERES":               return "PROVEEDOR_ALQUILERES";
    case "IT_SOFTWARE":              return "PROVEEDOR_IT_SOFTWARE";
    case "GASTOS_PORTUARIOS":        return "PROVEEDOR_GASTOS_PORTUARIOS";
    case "MARKETING":                return "PROVEEDOR_MARKETING";
    case "OTRO":                     return "PROVEEDOR_OTRO";
    case "MERCADERIA_EXTERIOR":      return "PROVEEDOR_MERCADERIA_EXTERIOR";
    case "SERVICIOS_EXTERIOR":       return "PROVEEDOR_SERVICIOS_EXTERIOR";
  }
}

/**
 * Rango de cuenta de gasto/activo (contrapartida del DEBE) por tipo de
 * proveedor. Devuelve null para tipos que no se desagregan
 * (MERCADERIA_LOCAL/EXTERIOR — usan stock compartido 1.1.5.x).
 */
export function rangoGastoByTipo(
  tipo: TipoProveedor,
): RangoCuentaAuto | null {
  switch (tipo) {
    case "MERCADERIA_LOCAL":         return null;
    case "MERCADERIA_EXTERIOR":      return null;
    case "DESPACHANTE":              return "GASTO_DESPACHANTE";
    case "SERVICIOS_PROFESIONALES":  return "GASTO_SERVICIOS_PROFESIONALES";
    case "ALQUILERES":               return "GASTO_ALQUILERES";
    case "IT_SOFTWARE":              return "GASTO_IT_SOFTWARE";
    case "MARKETING":                return "GASTO_MARKETING";
    case "OTRO":                     return "GASTO_OTRO";
    case "GASTOS_PORTUARIOS":        return "GASTO_GASTOS_PORTUARIOS";
    case "LOGISTICA":                return "GASTO_LOGISTICA";
    case "ALMACENAJE":               return "GASTO_ALMACENAJE";
    case "SERVICIOS_EXTERIOR":       return "GASTO_SERVICIOS_EXTERIOR";
  }
}

export function rangoClienteByCanal(canal: TipoCanal): RangoCuentaAuto {
  switch (canal) {
    case "MAYORISTA":          return "CLIENTE_MAYORISTA";
    case "MINORISTA":          return "CLIENTE_MINORISTA";
    case "REVENDEDOR_GOMERIA": return "CLIENTE_REVENDEDOR_GOMERIA";
    case "TRANSPORTISTA":      return "CLIENTE_TRANSPORTISTA";
    case "GRANDE_CUENTA":      return "CLIENTE_GRANDE_CUENTA";
    case "EXTERIOR":           return "CLIENTE_EXTERIOR";
    case "CONSUMIDOR_FINAL":   return "CLIENTE_CONSUMIDOR_FINAL";
  }
}

export function esTipoProveedorExtranjero(tipo: TipoProveedor): boolean {
  return tipo === "MERCADERIA_EXTERIOR" || tipo === "SERVICIOS_EXTERIOR";
}

/** @deprecated use rangoProveedorByTipo. Kept for backwards compat during refactor. */
export function rangoProveedor(pais: string): RangoCuentaAuto {
  return pais === "AR" ? "PROVEEDOR_MERCADERIA_LOCAL" : "PROVEEDOR_MERCADERIA_EXTERIOR";
}
