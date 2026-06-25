import "server-only";

import { db } from "@/lib/db";
import { Role } from "@/generated/prisma/client";
import { isRbacEnabled } from "@/lib/features";
import { PERMISOS, type PermisoKey, USER_BASE_CLAVES } from "@/lib/permisos-catalog";

// Resolución de permisos contra la DB, SIN dependencia de `@/lib/auth`. Vive en
// su propio módulo para romper el ciclo de imports auth → permisos → auth: lo
// importan tanto `@/lib/auth` (authorize, para grabar el set en el JWT al login)
// como `@/lib/permisos` (los guards ligados a la sesión). Aquí no se llama a
// `auth()`: las funciones reciben el userId / el usuario ya cargado.

const CLAVES_BASE: ReadonlySet<string> = new Set(USER_BASE_CLAVES);

/** Una clave admin-scoped (flag OFF) es cualquiera que no sea base. */
export function isAdminScopedKey(key: PermisoKey): boolean {
  return !CLAVES_BASE.has(key);
}

/** Lectura mínima común al camino flag-OFF (NO toca tablas nuevas). */
export function loadUserBase(id: string): Promise<{ activo: boolean; role: Role } | null> {
  return db.user.findUnique({ where: { id }, select: { activo: true, role: true } });
}

/** Lectura enriquecida — sólo se alcanza con la flag ON. */
export function loadUserForPermiso(id: string) {
  return db.user.findUnique({
    where: { id },
    select: {
      activo: true,
      role: true,
      perfilId: true,
      perfil: {
        select: {
          codigo: true,
          esSistema: true,
          activo: true,
          permisos: { select: { permiso: { select: { clave: true } } } },
        },
      },
      usuarioPermisos: {
        select: { concedido: true, expiraEn: true, permiso: { select: { clave: true } } },
      },
    },
  });
}

export type LoadedUser = NonNullable<Awaited<ReturnType<typeof loadUserForPermiso>>>;

/** Fast-path ADMIN: rol ADMIN o perfil de sistema "ADMIN" ⇒ todo concedido. */
export function isAdminFastPath(u: LoadedUser): boolean {
  if (u.role === Role.ADMIN) return true;
  return u.perfil?.esSistema === true && u.perfil.codigo === "ADMIN";
}

/** Default por rol cuando perfilId es null (usuarios pre-RBAC). */
function defaultPermisosForRole(role: Role): Set<string> {
  if (role === Role.ADMIN) return new Set<string>(Object.values(PERMISOS));
  return new Set<string>(CLAVES_BASE);
}

/**
 * Set efectivo (flag ON): grants del perfil ∪ overrides concedidos no vencidos
 * − revokes. perfilId null ⇒ default por rol. El fast-path ADMIN lo maneja el
 * caller (acá no), para mantener la complejidad acotada.
 */
export function resolveEffectivePermisos(u: LoadedUser): Set<string> {
  if (!u.perfilId || !u.perfil) return defaultPermisosForRole(u.role);

  const effective = new Set<string>();
  if (u.perfil.activo) {
    for (const pp of u.perfil.permisos) effective.add(pp.permiso.clave);
  }
  const ahora = new Date();
  for (const up of u.usuarioPermisos) {
    if (up.expiraEn !== null && up.expiraEn <= ahora) continue; // vencido: ignorar
    if (up.concedido) effective.add(up.permiso.clave);
    else effective.delete(up.permiso.clave); // revoke gana sobre el grant del perfil
  }
  return effective;
}

/**
 * Resuelve el set efectivo para grabar en el token AL LOGIN (conveniencia FE).
 * NUNCA debe romper el login: cualquier error ⇒ undefined (el BE revalida). Con
 * la flag OFF devuelve undefined (no escribimos permisos en tokens legacy).
 */
export async function resolvePermisosParaToken(
  userId: string,
): Promise<{ permisos: string[]; perfilCodigo?: string } | undefined> {
  if (!isRbacEnabled()) return undefined;
  try {
    const user = await loadUserForPermiso(userId);
    if (!user) return undefined;
    if (isAdminFastPath(user)) {
      return { permisos: Object.values(PERMISOS), perfilCodigo: user.perfil?.codigo ?? "ADMIN" };
    }
    return { permisos: [...resolveEffectivePermisos(user)], perfilCodigo: user.perfil?.codigo };
  } catch (err) {
    console.warn("[rbac] resolvePermisosParaToken falló; el login continúa sin permisos", err);
    return undefined;
  }
}
