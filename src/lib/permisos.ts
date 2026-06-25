import "server-only";

import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { Role } from "@/generated/prisma/client";
import { isRbacEnabled } from "@/lib/features";
import {
  type AdminGuardResult,
  requireAdmin,
  requireAdminPage,
  requireSessionUser,
} from "@/lib/auth-guard";
import { PERMISOS, type PermisoKey } from "@/lib/permisos-catalog";
import {
  isAdminFastPath,
  isAdminScopedKey,
  loadUserBase,
  loadUserForPermiso,
  resolveEffectivePermisos,
} from "@/lib/permisos-resolver";

// Re-export para que los callers tengan un único punto de import (clave +
// guard) — p.ej. `import { PERMISOS, requirePermissionPage } from "@/lib/permisos"`.
export { PERMISOS, type PermisoKey };
export { resolvePermisosParaToken } from "@/lib/permisos-resolver";

/**
 * Motor de permisos RBAC (PR-006), guards ligados a la sesión. Convive con los
 * guards legacy de `auth-guard.ts` sin alterarlos; la resolución pura-DB vive
 * en `@/lib/permisos-resolver` (sin dependencia de `auth()`, para romper el
 * ciclo de imports con `@/lib/auth`).
 *
 * **Regla con la flag RBAC OFF (default)** — reproduce los dos niveles de hoy:
 *  - una clave base (`USER_BASE_CLAVES`) → cualquier usuario activo;
 *  - cualquier otra clave → exige `role === ADMIN`.
 * El camino OFF usa SÓLO `db.user.findUnique({select:{activo,role}})`: no toca
 * las tablas nuevas (Perfil/Permiso/UsuarioPermiso). Cero regresión y no rompe
 * el mock de DB de los tests existentes.
 *
 * **Con la flag ON** — set efectivo desde la DB con fast-path ADMIN y fallback
 * por rol cuando `perfilId` es null (usuarios pre-RBAC se comportan como hoy).
 *
 * Como los guards legacy, el BE SIEMPRE revalida contra la DB; nunca confía en
 * el JWT. `session.user.permisos` es sólo una conveniencia para el FE (PR-007).
 */

/**
 * ¿El usuario de la sesión actual tiene la clave? Revalida contra DB.
 * Flag OFF ⇒ regla legacy de dos niveles (sólo tabla User). Flag ON ⇒ set
 * efectivo desde DB con fast-path ADMIN.
 */
export async function hasPermission(key: PermisoKey): Promise<boolean> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return false;

  if (!isRbacEnabled()) {
    const user = await loadUserBase(id); // SÓLO tabla User
    if (!user?.activo) return false;
    if (user.role === Role.ADMIN) return true; // ADMIN nunca bloqueado
    return !isAdminScopedKey(key); // base ⇒ true; admin-scoped ⇒ false
  }

  const user = await loadUserForPermiso(id); // tablas nuevas (sólo flag ON)
  if (!user?.activo) return false;
  if (isAdminFastPath(user)) return true; // ADMIN nunca bloqueado
  return resolveEffectivePermisos(user).has(key);
}

/**
 * Hermano de `requireAdmin`: contrato `{ ok, error }` para server actions
 * (no lanza redirect — su try/catch se lo tragaría). `scope` queda reservado
 * para chequeos de ámbito (UsuarioPermiso.ambito) en PRs futuros; hoy no se
 * evalúa. Flag OFF + clave admin-scoped ⇒ DELEGA en `requireAdmin()` ⇒ idéntico.
 */
export async function requirePermission(
  key: PermisoKey,
  _scope?: Record<string, unknown>,
): Promise<AdminGuardResult> {
  if (!isRbacEnabled() && isAdminScopedKey(key)) {
    return requireAdmin();
  }

  const session = await auth();
  const id = session?.user?.id;
  if (!id) return { ok: false, error: "No autorizado." };

  if (await hasPermission(key)) return { ok: true, userId: id };

  const user = await loadUserBase(id);
  if (!user?.activo) return { ok: false, error: "No autorizado." };
  return { ok: false, error: "Requiere permisos de administrador." };
}

/**
 * Hermano de `requireAdminPage`: redirige a /dashboard cuando falta la clave;
 * devuelve userId si la tiene. Flag OFF + clave admin-scoped ⇒ DELEGA en
 * `requireAdminPage()` ⇒ mismos redirects y mismas lecturas de DB (idéntico).
 */
export async function requirePermissionPage(key: PermisoKey): Promise<string> {
  if (!isRbacEnabled() && isAdminScopedKey(key)) {
    return requireAdminPage();
  }

  const userId = await requireSessionUser(); // → /login si la sesión es inválida
  if (!(await hasPermission(key))) redirect("/dashboard");
  return userId;
}
