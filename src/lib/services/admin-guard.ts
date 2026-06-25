import "server-only";

import { headers } from "next/headers";

import { type AdminGuardResult } from "@/lib/auth-guard";
import { Prisma, Role } from "@/generated/prisma/client";
import { PERMISOS, requirePermission } from "@/lib/permisos";

/*
 * Helpers compartidos de las admin actions de PERM-01 (PR-009). CONSUMEN el
 * motor RBAC (PR-006) sin alterarlo: el gate es `requirePermission(ADMIN_ACCESO)`
 * — con la flag RBAC OFF (default) delega en requireAdmin() ⇒ sólo el Master
 * (role ADMIN) pasa; con la flag ON exige la clave `admin.acceso`. Acá viven
 * además las protecciones de lockout (no dejar el sistema sin Master, no
 * auto-degradarse) y la captura de IP para auditar cambios de permiso sensibles
 * (G-07 / CRIT-11).
 */

/** Gate de todas las admin actions de Usuarios/Permisos: exige `admin.acceso`. */
export function requireAdminAction(): Promise<AdminGuardResult> {
  return requirePermission(PERMISOS.ADMIN_ACCESO);
}

// Cliente mínimo para contar masters dentro o fuera de una $transaction (db o tx).
type GuardDb = Pick<Prisma.TransactionClient, "user">;

/** Cuenta los Master activos (role ADMIN + activo). Opcionalmente excluye un id. */
export function contarMastersActivos(client: GuardDb, excluyendoId?: string): Promise<number> {
  return client.user.count({
    where: {
      role: Role.ADMIN,
      activo: true,
      ...(excluyendoId ? { id: { not: excluyendoId } } : {}),
    },
  });
}

type EstadoMaster = { role: Role; activo: boolean };

/**
 * Protección de lockout: impide quitar el último Master del sistema y que un
 * Master se quite a sí mismo su propio acceso. Devuelve el mensaje de error si
 * la operación dejaría el sistema sin Master (o es auto-degradación), o `null`
 * si es segura. "Master" = usuario con `role ADMIN` activo (el superusuario de
 * hoy; con RBAC OFF es lo que gobierna el acceso).
 */
export async function validarNoQuitarUltimoMaster(
  client: GuardDb,
  targetId: string,
  sessionUserId: string,
  antes: EstadoMaster,
  despues: EstadoMaster,
): Promise<string | null> {
  const eraMaster = antes.role === Role.ADMIN && antes.activo;
  const sigueMaster = despues.role === Role.ADMIN && despues.activo;
  if (!eraMaster || sigueMaster) return null; // no pierde el status Master

  if (targetId === sessionUserId) {
    return "No podés quitarte tu propio acceso Master.";
  }
  const otrosMasters = await contarMastersActivos(client, targetId);
  if (otrosMasters === 0) {
    return "No se puede dejar el sistema sin ningún Master activo.";
  }
  return null;
}

/** IP del request (X-Forwarded-For / X-Real-IP) para auditar cambios sensibles. */
export async function getRequestIp(): Promise<string | null> {
  try {
    const h = await headers();
    const xff = h.get("x-forwarded-for");
    if (xff) return xff.split(",")[0]?.trim() ?? null;
    return h.get("x-real-ip");
  } catch {
    return null;
  }
}
