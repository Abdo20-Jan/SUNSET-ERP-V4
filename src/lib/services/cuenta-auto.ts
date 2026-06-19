import "server-only";

import { CuentaCategoria, CuentaTipo, type Naturaleza, Prisma } from "@/generated/prisma/client";
import { naturalezaPorDefecto } from "./cuenta-naturaleza";
import { categoriaPorClase, PLAN_CUENTAS } from "./plan-de-cuentas";

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

// Datos del plan único (`PLAN_CUENTAS`, 631 cuentas) indexados por código. Es
// la red de seguridad para la auto-creación lazy: si la DB quedó atrás del
// registry, las cuentas/sintéticas que falten se crean con el MISMO nombre,
// categoría y naturaleza que declara el plan — sin tablas paralelas que se
// desincronicen en cada renumeración (ETAPA 3: antes era un mapa hardcodeado
// `SINTETICA_DEFAULTS` que apuntaba al plan viejo).
type PlanInfo = {
  nombre: string;
  categoria: CuentaCategoria;
  naturaleza: Naturaleza;
  tipo: CuentaTipo;
};
const PLAN_POR_CODIGO: ReadonlyMap<string, PlanInfo> = new Map(
  PLAN_CUENTAS.map((c) => [
    c.codigo,
    {
      nombre: c.nombre,
      categoria: categoriaPorClase(c.clase) as CuentaCategoria,
      naturaleza: c.naturaleza as Naturaleza,
      tipo: c.tipo as CuentaTipo,
    },
  ]),
);

/**
 * Asegura que la SINTETICA padre existe (recursivamente) creándola si
 * falta. Evita el error de FK al crear ANALITICAs cuyo padre no fue
 * declarado en seed. Idempotente. Toma nombre/categoría/naturaleza del plan
 * (`PLAN_POR_CODIGO`); si el código no está en el plan, cae a defaults por
 * categoría (caso de cuentas dinámicas fuera de catálogo).
 */
async function ensurePadreSintetica(
  tx: TxClient,
  padreCodigo: string,
  categoria: CuentaCategoria,
): Promise<void> {
  const existing = await tx.cuentaContable.findUnique({
    where: { codigo: padreCodigo },
    select: { codigo: true },
  });
  if (existing) return;

  const abuelo = derivePadreCodigo(padreCodigo);
  if (abuelo) {
    await ensurePadreSintetica(tx, abuelo, categoria);
  }

  const plan = PLAN_POR_CODIGO.get(padreCodigo);
  const nivel = deriveNivel(padreCodigo);
  await tx.cuentaContable.create({
    data: {
      codigo: padreCodigo,
      nombre: plan?.nombre ?? `RUBRO ${padreCodigo}`,
      tipo: CuentaTipo.SINTETICA,
      categoria: plan?.categoria ?? categoria,
      nivel,
      padreCodigo: abuelo,
      activa: true,
      naturaleza: plan?.naturaleza ?? naturalezaPorDefecto(plan?.categoria ?? categoria),
    },
  });
}

/**
 * Devuelve el id de la cuenta con el código dado; si no existe la crea
 * como ANALITICA. Idempotente — útil para asiento generators que ya no
 * dependen de un seed pre-poblado. Auto-crea SINTETICAs padre faltantes
 * para evitar FK errors si la base de datos quedó atrás del registry.
 */
export async function getOrCreateCuenta(tx: TxClient, def: CuentaDef): Promise<number> {
  const existing = await tx.cuentaContable.findUnique({
    where: { codigo: def.codigo },
    select: { id: true, activa: true },
  });
  if (existing) return existing.id;

  const padreCodigo = def.padreCodigo ?? derivePadreCodigo(def.codigo);
  const nivel = def.nivel ?? deriveNivel(def.codigo);
  if (padreCodigo) {
    await ensurePadreSintetica(tx, padreCodigo, def.categoria);
  }
  // Si el código está en el plan, se crea idéntico al catálogo (nombre,
  // categoría y naturaleza) — así una cuenta como 1.1.7.90 (contra-activo,
  // ACREEDOR) nace con el signo correcto aun en una DB sin seed. El registry
  // sólo dicta el código; el plan manda los atributos.
  const plan = PLAN_POR_CODIGO.get(def.codigo);
  const created = await tx.cuentaContable.create({
    data: {
      codigo: def.codigo,
      nombre: plan?.nombre ?? def.nombre,
      tipo: CuentaTipo.ANALITICA,
      categoria: plan?.categoria ?? def.categoria,
      nivel,
      padreCodigo,
      activa: true,
      naturaleza: plan?.naturaleza ?? naturalezaPorDefecto(def.categoria),
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
  // Cliente — por canal, bajo 1.1.3.01 (nacional) / 1.1.3.02 (exterior).
  CLIENTE_MAYORISTA: { padre: "1.1.3.01", min: 10, max: 19, categoria: CuentaCategoria.ACTIVO },
  CLIENTE_MINORISTA: { padre: "1.1.3.01", min: 20, max: 29, categoria: CuentaCategoria.ACTIVO },
  CLIENTE_REVENDEDOR_GOMERIA: {
    padre: "1.1.3.01",
    min: 30,
    max: 39,
    categoria: CuentaCategoria.ACTIVO,
  },
  CLIENTE_TRANSPORTISTA: { padre: "1.1.3.01", min: 40, max: 49, categoria: CuentaCategoria.ACTIVO },
  CLIENTE_GRANDE_CUENTA: { padre: "1.1.3.01", min: 50, max: 59, categoria: CuentaCategoria.ACTIVO },
  CLIENTE_EXTERIOR: { padre: "1.1.3.02", min: 10, max: 69, categoria: CuentaCategoria.ACTIVO },
  CLIENTE_CONSUMIDOR_FINAL: {
    padre: "1.1.3.01",
    min: 90,
    max: 98,
    categoria: CuentaCategoria.ACTIVO,
  },

  // Proveedor nacional de bienes/servicios generales — bajo 2.1.1.01.
  PROVEEDOR_MERCADERIA_LOCAL: {
    padre: "2.1.1.01",
    min: 10,
    max: 14,
    categoria: CuentaCategoria.PASIVO,
  },
  PROVEEDOR_SERVICIOS_PROFESIONALES: {
    padre: "2.1.1.01",
    min: 30,
    max: 34,
    categoria: CuentaCategoria.PASIVO,
  },
  PROVEEDOR_ALQUILERES: { padre: "2.1.1.01", min: 35, max: 39, categoria: CuentaCategoria.PASIVO },
  PROVEEDOR_IT_SOFTWARE: { padre: "2.1.1.01", min: 40, max: 44, categoria: CuentaCategoria.PASIVO },
  PROVEEDOR_MARKETING: { padre: "2.1.1.01", min: 50, max: 54, categoria: CuentaCategoria.PASIVO },
  PROVEEDOR_OTRO: { padre: "2.1.1.01", min: 55, max: 99, categoria: CuentaCategoria.PASIVO },

  // Proveedor de servicios logísticos y aduaneros — bajo el padre dedicado
  // 2.1.1.03 (separado de las deudas comerciales generales 2.1.1.01).
  PROVEEDOR_DESPACHANTE: { padre: "2.1.1.03", min: 10, max: 19, categoria: CuentaCategoria.PASIVO },
  PROVEEDOR_LOGISTICA: { padre: "2.1.1.03", min: 20, max: 29, categoria: CuentaCategoria.PASIVO },
  PROVEEDOR_ALMACENAJE: { padre: "2.1.1.03", min: 30, max: 39, categoria: CuentaCategoria.PASIVO },
  PROVEEDOR_GASTOS_PORTUARIOS: {
    padre: "2.1.1.03",
    min: 40,
    max: 49,
    categoria: CuentaCategoria.PASIVO,
  },

  // Proveedor extranjero — bajo 2.1.1.02 PROVEEDORES DEL EXTERIOR.
  PROVEEDOR_MERCADERIA_EXTERIOR: {
    padre: "2.1.1.02",
    min: 10,
    max: 49,
    categoria: CuentaCategoria.PASIVO,
  },
  PROVEEDOR_SERVICIOS_EXTERIOR: {
    padre: "2.1.1.02",
    min: 50,
    max: 99,
    categoria: CuentaCategoria.PASIVO,
  },

  // Cuenta de gasto POR PROVEEDOR (contrapartida del DEBE en facturas) — sólo
  // gastos de PERÍODO, bajo sintéticas dedicadas .09. Los servicios de
  // IMPORTACIÓN capitalizan al stock (1.1.7.05, RT17) vía
  // GASTO_POR_TIPO_PROVEEDOR y NO crean cuenta de resultado (rangoGastoByTipo
  // → null). MERCADERIA_LOCAL/EXTERIOR tampoco se desagregan.
  GASTO_SERVICIOS_PROFESIONALES: {
    padre: "7.2.09",
    min: 10,
    max: 29,
    categoria: CuentaCategoria.EGRESO,
  },
  GASTO_ALQUILERES: { padre: "7.4.09", min: 10, max: 29, categoria: CuentaCategoria.EGRESO },
  GASTO_IT_SOFTWARE: { padre: "7.3.09", min: 10, max: 29, categoria: CuentaCategoria.EGRESO },
  GASTO_MARKETING: { padre: "6.4.09", min: 10, max: 49, categoria: CuentaCategoria.EGRESO },
  GASTO_OTRO: { padre: "7.9.09", min: 10, max: 89, categoria: CuentaCategoria.EGRESO },

  // Bancos / cajas / préstamos — sin desagregación por tipo. Préstamos
  // bancarios: corrientes bajo 2.1.2.02, no corrientes bajo 2.2.1.01.
  CAJA: { padre: "1.1.1.01", min: 10, max: 90, categoria: CuentaCategoria.ACTIVO },
  BANCO: { padre: "1.1.1.02", min: 10, max: 99, categoria: CuentaCategoria.ACTIVO },
  PRESTAMO_CP: { padre: "2.1.2.02", min: 10, max: 99, categoria: CuentaCategoria.PASIVO },
  PRESTAMO_LP: { padre: "2.2.1.01", min: 10, max: 99, categoria: CuentaCategoria.PASIVO },
} as const;

export type RangoCuentaAuto = keyof typeof RANGES;

function siguienteCodigo(
  existentes: string[],
  padre: string,
  min: number,
  max: number,
): string | null {
  const prefix = `${padre}.`;
  const usados = new Set<number>();
  for (const c of existentes) {
    if (!c.startsWith(prefix)) continue;
    const sufijo = c.slice(prefix.length);
    if (!/^\d+$/.test(sufijo)) continue;
    const n = Number.parseInt(sufijo, 10);
    if (n >= min && n <= max) usados.add(n);
  }
  for (let n = min; n <= max; n++) {
    if (!usados.has(n)) return `${prefix}${String(n).padStart(2, "0")}`;
  }
  return null;
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
  const codigosExistentes = existentes.map((c) => c.codigo);
  // 1) Intenta el rango específico del tipo. Si está lleno (ej. el user
  //    cargó >5 proveedores LOGISTICA), cae al rango completo del padre
  //    (10-99) — agarra cualquier slot libre, mezclando tipos. La
  //    distinción de tipo queda en `Proveedor.tipoProveedor` (no en el
  //    código de cuenta), así que no rompe nada — sólo deja de agrupar
  //    visualmente más allá de los 5 primeros.
  let codigo = siguienteCodigo(codigosExistentes, cfg.padre, cfg.min, cfg.max);
  if (!codigo) {
    codigo = siguienteCodigo(codigosExistentes, cfg.padre, 10, 99);
  }
  if (!codigo) {
    throw new Error(
      `No hay códigos disponibles bajo ${cfg.padre}.10-99. Cree la cuenta manualmente.`,
    );
  }
  const created = await tx.cuentaContable.create({
    data: {
      codigo,
      nombre: nombre.toUpperCase().slice(0, 80),
      tipo: CuentaTipo.ANALITICA,
      categoria: cfg.categoria,
      // Derivado del código (los padres ULTRA varían de nivel: 1.1.1.01 caja=5,
      // 2.1.1.01 proveedor=4, 1.1.3.01 cliente=4).
      nivel: deriveNivel(codigo),
      padreCodigo: cfg.padre,
      activa: true,
      naturaleza: naturalezaPorDefecto(cfg.categoria),
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
    case "MERCADERIA_LOCAL":
      return "PROVEEDOR_MERCADERIA_LOCAL";
    case "DESPACHANTE":
      return "PROVEEDOR_DESPACHANTE";
    case "LOGISTICA":
      return "PROVEEDOR_LOGISTICA";
    case "ALMACENAJE":
      return "PROVEEDOR_ALMACENAJE";
    case "SERVICIOS_PROFESIONALES":
      return "PROVEEDOR_SERVICIOS_PROFESIONALES";
    case "ALQUILERES":
      return "PROVEEDOR_ALQUILERES";
    case "IT_SOFTWARE":
      return "PROVEEDOR_IT_SOFTWARE";
    case "GASTOS_PORTUARIOS":
      return "PROVEEDOR_GASTOS_PORTUARIOS";
    case "MARKETING":
      return "PROVEEDOR_MARKETING";
    case "OTRO":
      return "PROVEEDOR_OTRO";
    case "MERCADERIA_EXTERIOR":
      return "PROVEEDOR_MERCADERIA_EXTERIOR";
    case "SERVICIOS_EXTERIOR":
      return "PROVEEDOR_SERVICIOS_EXTERIOR";
  }
}

/**
 * Rango de cuenta de gasto/activo (contrapartida del DEBE) por tipo de
 * proveedor. Devuelve null para tipos que no se desagregan
 * (MERCADERIA_LOCAL/EXTERIOR — usan stock compartido 1.1.7.x).
 */
export function rangoGastoByTipo(tipo: TipoProveedor): RangoCuentaAuto | null {
  switch (tipo) {
    case "MERCADERIA_LOCAL":
      return null;
    case "MERCADERIA_EXTERIOR":
      return null;
    // Servicios de importación: capitalizan a 1.1.7.05 (RT17) vía
    // GASTO_POR_TIPO_PROVEEDOR — sin cuenta de resultado por proveedor.
    case "DESPACHANTE":
    case "GASTOS_PORTUARIOS":
    case "LOGISTICA":
    case "ALMACENAJE":
    case "SERVICIOS_EXTERIOR":
      return null;
    case "SERVICIOS_PROFESIONALES":
      return "GASTO_SERVICIOS_PROFESIONALES";
    case "ALQUILERES":
      return "GASTO_ALQUILERES";
    case "IT_SOFTWARE":
      return "GASTO_IT_SOFTWARE";
    case "MARKETING":
      return "GASTO_MARKETING";
    case "OTRO":
      return "GASTO_OTRO";
  }
}

export function rangoClienteByCanal(canal: TipoCanal): RangoCuentaAuto {
  switch (canal) {
    case "MAYORISTA":
      return "CLIENTE_MAYORISTA";
    case "MINORISTA":
      return "CLIENTE_MINORISTA";
    case "REVENDEDOR_GOMERIA":
      return "CLIENTE_REVENDEDOR_GOMERIA";
    case "TRANSPORTISTA":
      return "CLIENTE_TRANSPORTISTA";
    case "GRANDE_CUENTA":
      return "CLIENTE_GRANDE_CUENTA";
    case "EXTERIOR":
      return "CLIENTE_EXTERIOR";
    case "CONSUMIDOR_FINAL":
      return "CLIENTE_CONSUMIDOR_FINAL";
  }
}

export function esTipoProveedorExtranjero(tipo: TipoProveedor): boolean {
  return tipo === "MERCADERIA_EXTERIOR" || tipo === "SERVICIOS_EXTERIOR";
}

/** @deprecated use rangoProveedorByTipo. Kept for backwards compat during refactor. */
export function rangoProveedor(pais: string): RangoCuentaAuto {
  return pais === "AR" ? "PROVEEDOR_MERCADERIA_LOCAL" : "PROVEEDOR_MERCADERIA_EXTERIOR";
}
