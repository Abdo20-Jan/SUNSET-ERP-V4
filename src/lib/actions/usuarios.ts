"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { db } from "@/lib/db";
import { Prisma, Role } from "@/generated/prisma/client";
import { registrarAuditoria } from "@/lib/services/auditoria";
import {
  getRequestIp,
  requireAdminAction,
  validarNoQuitarUltimoMaster,
} from "@/lib/services/admin-guard";

/*
 * Admin actions de Usuarios (PR-009 — PERM-01). CONSUMEN PR-006 (gate
 * `requireAdminAction` = requirePermission(ADMIN_ACCESO)) y PR-008
 * (`registrarAuditoria`) de forma aditiva: NO tocan el motor RBAC, ni el
 * schema, ni la forma de la sesión/JWT. Todo cambio es sensible ⇒ auditado
 * (G-07/CRIT-11), con motivo obligatorio en lo destructivo y protección de
 * lockout (no quedar sin Master).
 */

export type UsuarioRow = {
  id: string;
  username: string;
  nombre: string;
  role: Role;
  activo: boolean;
  perfilCodigo: string | null;
  perfilNombre: string | null;
  updatedAt: Date;
};

export type UsuarioDetalle = {
  id: string;
  username: string;
  nombre: string;
  role: Role;
  activo: boolean;
  perfilId: string | null;
  perfilCodigo: string | null;
  perfilNombre: string | null;
  monedaPreferida: string | null;
  modoRetroactivo: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type UsuarioActionResult = { ok: true; id: string } | { ok: false; error: string };

// Campos JSON-safe (sólo scalars/enums; sin Date/Decimal) versionados en la
// auditoría. NO exportar (archivo "use server").
const SNAPSHOT_USER = {
  username: true,
  nombre: true,
  role: true,
  activo: true,
  perfilId: true,
  monedaPreferida: true,
  modoRetroactivo: true,
} as const;

export async function listarUsuarios(): Promise<UsuarioRow[]> {
  const rows = await db.user.findMany({
    orderBy: { nombre: "asc" },
    select: {
      id: true,
      username: true,
      nombre: true,
      role: true,
      activo: true,
      updatedAt: true,
      perfil: { select: { codigo: true, nombre: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    nombre: r.nombre,
    role: r.role,
    activo: r.activo,
    updatedAt: r.updatedAt,
    perfilCodigo: r.perfil?.codigo ?? null,
    perfilNombre: r.perfil?.nombre ?? null,
  }));
}

export async function obtenerUsuarioPorId(id: string): Promise<UsuarioDetalle | null> {
  const u = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      username: true,
      nombre: true,
      role: true,
      activo: true,
      perfilId: true,
      monedaPreferida: true,
      modoRetroactivo: true,
      createdAt: true,
      updatedAt: true,
      perfil: { select: { codigo: true, nombre: true } },
    },
  });
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    nombre: u.nombre,
    role: u.role,
    activo: u.activo,
    perfilId: u.perfilId,
    perfilCodigo: u.perfil?.codigo ?? null,
    perfilNombre: u.perfil?.nombre ?? null,
    monedaPreferida: u.monedaPreferida,
    modoRetroactivo: u.modoRetroactivo,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

const nullablePerfilId = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : null));

const crearUsuarioSchema = z.object({
  username: z.string().trim().min(3, "El usuario debe tener al menos 3 caracteres."),
  nombre: z.string().trim().min(1, "El nombre es obligatorio."),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres."),
  role: z.nativeEnum(Role).optional().default(Role.USER),
  perfilId: nullablePerfilId,
  activo: z.boolean().optional().default(true),
});
export type CrearUsuarioInput = z.input<typeof crearUsuarioSchema>;

const actualizarUsuarioSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio."),
  role: z.nativeEnum(Role),
  perfilId: nullablePerfilId,
  activo: z.boolean(),
  password: z
    .string()
    .min(6, "La contraseña debe tener al menos 6 caracteres.")
    .optional()
    .or(z.literal("")),
  motivo: z.string().trim().optional(),
});
export type ActualizarUsuarioInput = z.input<typeof actualizarUsuarioSchema>;

const desactivarUsuarioSchema = z.object({
  motivo: z.string().trim().min(1, "El motivo es obligatorio."),
});

const asignarPerfilSchema = z.object({
  perfilId: nullablePerfilId,
  motivo: z.string().trim().optional(),
});
export type AsignarPerfilInput = z.input<typeof asignarPerfilSchema>;

function mapUsuarioError(err: unknown, op: "crear" | "actualizar"): { ok: false; error: string } {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return { ok: false, error: "El nombre de usuario ya existe." };
    if (err.code === "P2025") return { ok: false, error: "El usuario no existe." };
  }
  console.error(`usuario ${op} falló`, err);
  return { ok: false, error: `Error inesperado al ${op} el usuario.` };
}

type EstadoUsuario = { role: Role; activo: boolean };

// Valida que un cambio de rol/estado tenga motivo y no provoque lockout.
// Extraído de la action para mantener su complejidad ciclomática ≤ 8.
async function validarCambioUsuario(
  targetId: string,
  sessionUserId: string,
  antes: EstadoUsuario,
  despues: EstadoUsuario,
  motivo: string | undefined,
): Promise<string | null> {
  const cambiaSensible = antes.role !== despues.role || antes.activo !== despues.activo;
  if (cambiaSensible && (!motivo || motivo.length === 0)) {
    return "Indicá un motivo para el cambio de rol o estado.";
  }
  return validarNoQuitarUltimoMaster(db, targetId, sessionUserId, antes, despues);
}

export async function crearUsuarioAction(raw: CrearUsuarioInput): Promise<UsuarioActionResult> {
  const guard = await requireAdminAction();
  if (!guard.ok) return guard;

  const parsed = crearUsuarioSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const { password, ...rest } = parsed.data;
  const ip = await getRequestIp();

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const created = await db.$transaction(async (tx) => {
      const { id, ...snapshot } = await tx.user.create({
        data: { ...rest, passwordHash },
        select: { id: true, ...SNAPSHOT_USER },
      });
      await registrarAuditoria(tx, {
        tabla: "User",
        registroId: id,
        accion: "CREATE",
        usuarioId: guard.userId,
        datosNuevos: snapshot,
        origen: "MANUAL",
        ip,
      });
      return { id };
    });
    revalidatePath("/sistema/usuarios");
    return { ok: true, id: created.id };
  } catch (err) {
    return mapUsuarioError(err, "crear");
  }
}

export async function actualizarUsuarioAction(
  id: string,
  raw: ActualizarUsuarioInput,
): Promise<UsuarioActionResult> {
  const guard = await requireAdminAction();
  if (!guard.ok) return guard;
  if (!id) return { ok: false, error: "Id requerido." };

  const parsed = actualizarUsuarioSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const { motivo, password, perfilId, ...rest } = parsed.data;

  const antes = await db.user.findUnique({ where: { id }, select: SNAPSHOT_USER });
  if (!antes) return { ok: false, error: "El usuario no existe." };

  const error = await validarCambioUsuario(
    id,
    guard.userId,
    { role: antes.role, activo: antes.activo },
    { role: rest.role, activo: rest.activo },
    motivo,
  );
  if (error) return { ok: false, error };

  const ip = await getRequestIp();
  try {
    const data: Prisma.UserUpdateInput = {
      ...rest,
      perfil: perfilId ? { connect: { id: perfilId } } : { disconnect: true },
    };
    if (password && password.length > 0) data.passwordHash = await bcrypt.hash(password, 10);

    await db.$transaction(async (tx) => {
      const { id: uid, ...despues } = await tx.user.update({
        where: { id },
        data,
        select: { id: true, ...SNAPSHOT_USER },
      });
      await registrarAuditoria(tx, {
        tabla: "User",
        registroId: uid,
        accion: "UPDATE",
        usuarioId: guard.userId,
        datosAnteriores: antes,
        datosNuevos: despues,
        motivo: motivo ?? null,
        origen: "MANUAL",
        ip,
      });
    });
    revalidatePath("/sistema/usuarios");
    revalidatePath(`/sistema/usuarios/${id}`);
    return { ok: true, id };
  } catch (err) {
    return mapUsuarioError(err, "actualizar");
  }
}

export async function desactivarUsuarioAction(
  id: string,
  motivo: string,
): Promise<UsuarioActionResult> {
  const guard = await requireAdminAction();
  if (!guard.ok) return guard;
  if (!id) return { ok: false, error: "Id requerido." };

  const parsed = desactivarUsuarioSchema.safeParse({ motivo });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  if (id === guard.userId) return { ok: false, error: "No podés desactivar tu propio usuario." };

  const antes = await db.user.findUnique({ where: { id }, select: SNAPSHOT_USER });
  if (!antes) return { ok: false, error: "El usuario no existe." };
  if (!antes.activo) return { ok: false, error: "El usuario ya está inactivo." };

  const lockout = await validarNoQuitarUltimoMaster(
    db,
    id,
    guard.userId,
    { role: antes.role, activo: antes.activo },
    { role: antes.role, activo: false },
  );
  if (lockout) return { ok: false, error: lockout };

  const ip = await getRequestIp();
  try {
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { activo: false }, select: { id: true } });
      await registrarAuditoria(tx, {
        tabla: "User",
        registroId: id,
        accion: "UPDATE",
        usuarioId: guard.userId,
        datosAnteriores: antes,
        datosNuevos: { ...antes, activo: false },
        motivo: parsed.data.motivo,
        origen: "MANUAL",
        ip,
      });
    });
    revalidatePath("/sistema/usuarios");
    revalidatePath(`/sistema/usuarios/${id}`);
    return { ok: true, id };
  } catch (err) {
    return mapUsuarioError(err, "actualizar");
  }
}

export async function asignarPerfilAction(
  userId: string,
  raw: AsignarPerfilInput,
): Promise<UsuarioActionResult> {
  const guard = await requireAdminAction();
  if (!guard.ok) return guard;
  if (!userId) return { ok: false, error: "Id requerido." };

  const parsed = asignarPerfilSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const { perfilId, motivo } = parsed.data;

  const antes = await db.user.findUnique({ where: { id: userId }, select: SNAPSHOT_USER });
  if (!antes) return { ok: false, error: "El usuario no existe." };

  if (perfilId) {
    const perfil = await db.perfil.findUnique({ where: { id: perfilId }, select: { id: true } });
    if (!perfil) return { ok: false, error: "El perfil no existe." };
  }

  const ip = await getRequestIp();
  try {
    await db.$transaction(async (tx) => {
      const { id: uid, ...despues } = await tx.user.update({
        where: { id: userId },
        data: { perfil: perfilId ? { connect: { id: perfilId } } : { disconnect: true } },
        select: { id: true, ...SNAPSHOT_USER },
      });
      await registrarAuditoria(tx, {
        tabla: "User",
        registroId: uid,
        accion: "UPDATE",
        usuarioId: guard.userId,
        datosAnteriores: antes,
        datosNuevos: despues,
        motivo: motivo ?? null,
        origen: "MANUAL",
        ip,
      });
    });
    revalidatePath(`/sistema/usuarios/${userId}`);
    revalidatePath("/sistema/usuarios");
    return { ok: true, id: userId };
  } catch (err) {
    return mapUsuarioError(err, "actualizar");
  }
}
