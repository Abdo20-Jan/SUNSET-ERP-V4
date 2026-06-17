import "server-only";

import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Role } from "@/generated/prisma/client";

// Motivos legibles que viajan en /login?motivo=… para que la página de login
// muestre un mensaje claro en vez de dejar al usuario adivinando.
export type MotivoSesion = "sesion-expirada" | "sesion-invalida" | "usuario-inactivo";

/**
 * Garantiza una sesión cuyo usuario AÚN existe y está activo en la base, y
 * devuelve su `id`.
 *
 * Por qué existe: la estrategia de sesión es JWT (auth.config.ts), así que el
 * `id` del usuario queda congelado en la cookie del navegador desde el login.
 * Tras un reseed de la base (frecuente en este proyecto) ese `id` puede apuntar
 * a un User que ya no existe. Escribirlo en una FK obligatoria —
 * RetencionPracticada.createdById, AuditLog.usuarioId, Lead/Oportunidad/
 * Actividad.ownerId, DespachoBorrador.userId — rompe con Prisma P2003 y la
 * server action explota como "Error inesperado", a veces tras montar medio
 * asiento dentro de una transacción que termina en rollback.
 *
 * Este guard detecta el caso ANTES de cualquier escritura y redirige a /login
 * con un motivo legible. Debe invocarse al TOPE de la action y FUERA de todo
 * try/catch: redirect() lanza NEXT_REDIRECT y un catch genérico lo tragaría,
 * volviendo a convertir el redirect en "Error inesperado".
 */
export async function requireSessionUser(): Promise<string> {
  const session = await auth();
  const sessionUserId = session?.user?.id;
  if (!sessionUserId) {
    redirect("/login?motivo=sesion-expirada");
  }

  const user = await db.user.findUnique({
    where: { id: sessionUserId },
    select: { id: true, activo: true },
  });
  if (!user) {
    redirect("/login?motivo=sesion-invalida");
  }
  if (!user.activo) {
    redirect("/login?motivo=usuario-inactivo");
  }

  return user.id;
}

/** Resultado discriminado del guard de autorización ADMIN. */
export type AdminGuardResult = { ok: true; userId: string } | { ok: false; error: string };

/**
 * Exige que el usuario de la sesión sea un ADMIN activo. A diferencia de
 * {@link requireSessionUser} (que redirige), devuelve un resultado discriminado
 * `{ ok, error }`: las actions administrativas (cerrar período, anular/mover
 * asiento, anular masivo) ya hablan ese contrato, y un redirect dentro de su
 * try/catch se tragaría como "Error inesperado".
 *
 * Revalida el rol contra la DB en cada llamada: la estrategia de sesión es JWT,
 * así que `session.user.role` queda congelado en la cookie desde el login y no
 * refleja un cambio de permisos ni un reseed. La consulta también detecta el
 * caso del user del JWT que ya no existe / está inactivo ANTES de cualquier
 * escritura de FK (evita el P2003 que explota como "Error inesperado").
 */
export async function requireAdmin(): Promise<AdminGuardResult> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) {
    return { ok: false, error: "No autorizado." };
  }

  const user = await db.user.findUnique({
    where: { id },
    select: { activo: true, role: true },
  });
  if (!user?.activo) {
    return { ok: false, error: "No autorizado." };
  }
  if (user.role !== Role.ADMIN) {
    return { ok: false, error: "Requiere permisos de administrador." };
  }

  return { ok: true, userId: id };
}

/**
 * Variante de {@link requireAdmin} para Server Components / páginas bajo /admin:
 * redirige (en vez de devolver un resultado) cuando el usuario no es ADMIN.
 * Defensa en profundidad sobre el gate del proxy (auth.config `authorized`): si
 * el matcher del proxy cambiara, la página igual queda protegida. Reusa
 * {@link requireSessionUser} (redirige a /login si la sesión es inválida) y
 * luego revalida el rol contra la DB. Debe invocarse al TOPE de la página y
 * FUERA de todo try/catch (redirect() lanza NEXT_REDIRECT).
 */
export async function requireAdminPage(): Promise<string> {
  const userId = await requireSessionUser();
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (user?.role !== Role.ADMIN) {
    redirect("/dashboard");
  }
  return userId;
}
