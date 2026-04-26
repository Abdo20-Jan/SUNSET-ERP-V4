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
