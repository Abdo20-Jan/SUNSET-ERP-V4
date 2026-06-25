// Catálogo de permisos RBAC (PR-006) — fuente de verdad en código.
//
// IMPORTANTE: este módulo NO lleva `import "server-only"` a propósito: lo
// importa tanto el motor de autorización (`@/lib/permisos`, server-only) como
// el seed (`prisma/seed.ts`, corre bajo tsx en Node). Mantenerlo libre de
// `server-only` evita romper el seed.
//
// Las `clave` son la única fuente de verdad: se siembran en la tabla `Permiso`
// y se referencian SIEMPRE de forma simbólica (PERMISOS.X), nunca como literal
// "x.y", en el código de negocio.

import { DimensionPermiso } from "@/generated/prisma/enums";

/**
 * Registro central de claves de permiso. Curado (~13 claves) a partir de los
 * call sites actuales de `requireAdmin` + una clave base (`app.acceso`) que
 * tiene todo usuario autenticado y la clave del piloto (`admin.acceso`).
 */
export const PERMISOS = {
  /** Acceso base a la app autenticada — cualquier usuario activo. */
  APP_ACCESO: "app.acceso",
  /** Acceso al área /admin (página piloto). Equivalente legacy de role ADMIN. */
  ADMIN_ACCESO: "admin.acceso",
  /** Anular un asiento. */
  ASIENTOS_ANULAR: "asientos.anular",
  /** Mover asientos de período. */
  ASIENTOS_MOVER: "asientos.mover",
  /** Cambiar fecha de asientos. */
  ASIENTOS_CAMBIAR_FECHA: "asientos.cambiarFecha",
  /** Auto-corregir fecha de asientos (masivo). */
  ASIENTOS_AUTO_CORREGIR_FECHA: "asientos.autoCorregirFecha",
  /** Crear período contable. */
  PERIODOS_CREAR: "periodos.crear",
  /** Cerrar período. */
  PERIODOS_CERRAR: "periodos.cerrar",
  /** Reabrir período. */
  PERIODOS_REABRIR: "periodos.reabrir",
  /** Cerrar ejercicio. */
  PERIODOS_CERRAR_EJERCICIO: "periodos.cerrarEjercicio",
  /** Destinar resultado del ejercicio. */
  PERIODOS_DESTINAR_RESULTADO: "periodos.destinarResultado",
  /** Listar ventas para recálculo de Percepción IIBB. */
  PERCEPCION_IIBB_RECALCULAR: "percepcionIibb.recalcular",
  /** Anular ventas en masa y liberar para recálculo de Percepción IIBB. */
  PERCEPCION_IIBB_ANULAR_Y_LIBERAR: "percepcionIibb.anularYLiberar",
  /** Acceso a la worklist global de auditoría (Sistema > Auditoría · AUD-01). */
  AUDITORIA_VER: "auditoria.ver",
  /** Exportar la auditoría (CSV/XLSX). La exportación es a su vez auditada. */
  AUDITORIA_EXPORTAR: "auditoria.exportar",
  /** Ver el costo unitario / CMV de un producto (campo de costo · PR-011). */
  VER_COSTO: "costos.ver",
  /** Ver el margen y la rentabilidad calculada (campo de margen · PR-011). */
  VER_MARGEN: "margenes.ver",
  /** Ver el costo landed (costo + flete + impuestos de importación · PR-011). */
  VER_COSTO_LANDED: "costos.verLanded",
  /** Ver el precio mínimo de venta (piso de pricing · reservado PR-011). */
  VER_PRECIO_MINIMO: "precios.verMinimo",
  /** Ver la valorización de costo del stock (inventario · PR-011). */
  VER_COSTO_STOCK: "stock.verCosto",
} as const;

export type PermisoKey = (typeof PERMISOS)[keyof typeof PERMISOS];

/** Una entrada del catálogo: clave + dimensión + descripción para el seed. */
export interface PermisoCatalogEntry {
  clave: PermisoKey;
  dimension: DimensionPermiso;
  descripcion: string;
}

/**
 * Catálogo completo que el seed (`seedRbacFoundation`) upserta en `Permiso`.
 * El perfil ADMIN recibe TODAS estas claves; el perfil USER recibe sólo
 * `USER_BASE_CLAVES`.
 */
export const PERMISSION_CATALOG: readonly PermisoCatalogEntry[] = [
  {
    clave: PERMISOS.APP_ACCESO,
    dimension: DimensionPermiso.MODULO,
    descripcion: "Acceso base a la app",
  },
  {
    clave: PERMISOS.ADMIN_ACCESO,
    dimension: DimensionPermiso.PAGINA,
    descripcion: "Acceso al área /admin",
  },
  {
    clave: PERMISOS.ASIENTOS_ANULAR,
    dimension: DimensionPermiso.ACCION,
    descripcion: "Anular un asiento",
  },
  {
    clave: PERMISOS.ASIENTOS_MOVER,
    dimension: DimensionPermiso.ACCION,
    descripcion: "Mover asientos de período",
  },
  {
    clave: PERMISOS.ASIENTOS_CAMBIAR_FECHA,
    dimension: DimensionPermiso.ACCION,
    descripcion: "Cambiar fecha de asientos",
  },
  {
    clave: PERMISOS.ASIENTOS_AUTO_CORREGIR_FECHA,
    dimension: DimensionPermiso.ACCION,
    descripcion: "Auto-corregir fecha de asientos",
  },
  {
    clave: PERMISOS.PERIODOS_CREAR,
    dimension: DimensionPermiso.ACCION,
    descripcion: "Crear período contable",
  },
  {
    clave: PERMISOS.PERIODOS_CERRAR,
    dimension: DimensionPermiso.ACCION,
    descripcion: "Cerrar período",
  },
  {
    clave: PERMISOS.PERIODOS_REABRIR,
    dimension: DimensionPermiso.ACCION,
    descripcion: "Reabrir período",
  },
  {
    clave: PERMISOS.PERIODOS_CERRAR_EJERCICIO,
    dimension: DimensionPermiso.ACCION,
    descripcion: "Cerrar ejercicio",
  },
  {
    clave: PERMISOS.PERIODOS_DESTINAR_RESULTADO,
    dimension: DimensionPermiso.ACCION,
    descripcion: "Destinar resultado del ejercicio",
  },
  {
    clave: PERMISOS.PERCEPCION_IIBB_RECALCULAR,
    dimension: DimensionPermiso.ACCION,
    descripcion: "Listar ventas para recálculo Percepción IIBB",
  },
  {
    clave: PERMISOS.PERCEPCION_IIBB_ANULAR_Y_LIBERAR,
    dimension: DimensionPermiso.ACCION,
    descripcion: "Anular ventas en masa y liberar Percepción IIBB",
  },
  {
    clave: PERMISOS.AUDITORIA_VER,
    dimension: DimensionPermiso.PAGINA,
    descripcion: "Ver la auditoría global (Sistema > Auditoría)",
  },
  {
    clave: PERMISOS.AUDITORIA_EXPORTAR,
    dimension: DimensionPermiso.EXPORTACION,
    descripcion: "Exportar la auditoría (auditada)",
  },
  {
    clave: PERMISOS.VER_COSTO,
    dimension: DimensionPermiso.CAMPO,
    descripcion: "Ver el costo unitario / CMV de un producto",
  },
  {
    clave: PERMISOS.VER_MARGEN,
    dimension: DimensionPermiso.CAMPO,
    descripcion: "Ver el margen y la rentabilidad calculada",
  },
  {
    clave: PERMISOS.VER_COSTO_LANDED,
    dimension: DimensionPermiso.CAMPO,
    descripcion: "Ver el costo landed (costo + flete + impuestos)",
  },
  {
    clave: PERMISOS.VER_PRECIO_MINIMO,
    dimension: DimensionPermiso.CAMPO,
    descripcion: "Ver el precio mínimo de venta",
  },
  {
    clave: PERMISOS.VER_COSTO_STOCK,
    dimension: DimensionPermiso.INFORMACION,
    descripcion: "Ver la valorización de costo del stock",
  },
];

/**
 * Claves "base" (no-admin): cualquier usuario activo las tiene. El perfil USER
 * de sistema recibe sólo estas. Con la flag RBAC OFF, una clave que NO esté
 * acá se considera admin-scoped (default conservador: requiere ADMIN).
 *
 * PR-011: las 5 claves de costo/margen son BASE a propósito. Con RBAC OFF eso
 * las vuelve visibles para cualquier usuario activo (= comportamiento de hoy,
 * cero regresión); con RBAC ON el perfil USER de sistema las recibe igual. La
 * máscara sólo "muerde" cuando un admin crea un perfil custom que las omite.
 */
export const USER_BASE_CLAVES: readonly PermisoKey[] = [
  PERMISOS.APP_ACCESO,
  PERMISOS.VER_COSTO,
  PERMISOS.VER_MARGEN,
  PERMISOS.VER_COSTO_LANDED,
  PERMISOS.VER_PRECIO_MINIMO,
  PERMISOS.VER_COSTO_STOCK,
];
