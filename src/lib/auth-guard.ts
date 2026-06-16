import "server-only";

import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

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
