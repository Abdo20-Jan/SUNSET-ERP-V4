import "server-only";

import { PERMISOS, type PermisoKey } from "@/lib/permisos-catalog";

/**
 * Máscara de costo/margen (PR-011). Los wrappers `puedeVer*` son delegaciones
 * finas sobre `hasPermission`: el BE es la ÚNICA protección real (CRIT-10) —
 * strip-ea el valor del payload cuando falta la clave; la máscara FE
 * (`PermissionGate`) es sólo reflejo de UX. No recalcula ni toca ningún motor:
 * lee la salida ya computada y la omite en la frontera del caller (action /
 * server component).
 *
 * Con RBAC OFF las 5 claves son base (`USER_BASE_CLAVES`) ⇒ `hasPermission`
 * devuelve `true` para todo usuario activo ⇒ cero regresión.
 *
 * `hasPermission` se importa de forma **perezosa** (dynamic import): así, importar
 * este módulo en un loader/action NO arrastra la cadena `@/lib/permisos → @/lib/auth`
 * (next-auth) en tiempo de carga — el motor sólo se resuelve al invocar el wrapper,
 * ya en runtime server. Mantiene los loaders livianos y testeables sin mockear auth.
 */
async function chequear(key: PermisoKey): Promise<boolean> {
  const { hasPermission } = await import("@/lib/permisos");
  return hasPermission(key);
}

/** ¿La sesión actual puede ver el costo unitario / CMV? */
export function puedeVerCosto(): Promise<boolean> {
  return chequear(PERMISOS.VER_COSTO);
}

/** ¿Puede ver el margen / la rentabilidad calculada? */
export function puedeVerMargen(): Promise<boolean> {
  return chequear(PERMISOS.VER_MARGEN);
}

/** ¿Puede ver el costo landed (costo + flete + impuestos de importación)? */
export function puedeVerCostoLanded(): Promise<boolean> {
  return chequear(PERMISOS.VER_COSTO_LANDED);
}

/** ¿Puede ver la valorización de costo del stock (inventario)? */
export function puedeVerCostoStock(): Promise<boolean> {
  return chequear(PERMISOS.VER_COSTO_STOCK);
}

/**
 * Strip genérico de un campo: devuelve `value` cuando `allowed`, si no `null`.
 * Puro y sin `await` — el caller resuelve el booleano UNA vez y enmascara N
 * campos sin volver a tocar la DB.
 */
export function maskField<T>(allowed: boolean, value: T): T | null {
  return allowed ? value : null;
}
