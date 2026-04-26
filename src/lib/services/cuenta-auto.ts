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
// Auto-creación de cuentas individuales (proveedor, cliente,
// caja, banco, préstamo) — numeración automática en rango
// ============================================================

/**
 * Crea o reutiliza una cuenta analítica individual para un proveedor o cliente
 * recién creado. La numeración va dentro de un prefijo padre de 3 segmentos
 * (ej. "2.1.1") con sufijo de 2 dígitos en un rango reservado para auto-creación,
 * para no chocar con las cuentas "genéricas" cargadas por seed (.01-.09).
 *
 * Rangos:
 *  - Proveedor nacional   → 2.1.1.10..99
 *  - Proveedor extranjero → 2.1.1.50..99 (mismo padre, suffix más alto)
 *  - Cliente              → 1.1.3.10..99
 */
const RANGES = {
  PROVEEDOR_NACIONAL: { padre: "2.1.1", min: 10, max: 49, categoria: CuentaCategoria.PASIVO },
  PROVEEDOR_EXTRANJERO: { padre: "2.1.1", min: 50, max: 99, categoria: CuentaCategoria.PASIVO },
  CLIENTE: { padre: "1.1.3", min: 10, max: 99, categoria: CuentaCategoria.ACTIVO },
  CAJA: { padre: "1.1.1", min: 10, max: 99, categoria: CuentaCategoria.ACTIVO },
  BANCO: { padre: "1.1.2", min: 10, max: 99, categoria: CuentaCategoria.ACTIVO },
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

export function rangoProveedor(pais: string): RangoCuentaAuto {
  return pais === "AR" ? "PROVEEDOR_NACIONAL" : "PROVEEDOR_EXTRANJERO";
}
