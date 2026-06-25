"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { type DimensionPermiso, Prisma } from "@/generated/prisma/client";
import { registrarAuditoria } from "@/lib/services/auditoria";
import { getRequestIp, requireAdminAction } from "@/lib/services/admin-guard";
import { PERMISOS } from "@/lib/permisos-catalog";
import {
  isAdminFastPath,
  loadUserForPermiso,
  resolveEffectivePermisos,
} from "@/lib/permisos-resolver";
import { toCsv } from "@/lib/export/csv";
import type { ExportColumn } from "@/lib/export/types";

/*
 * Admin actions de Permisos (PR-009 — PERM-01): perfiles, matriz perfil×clave,
 * overrides por usuario, escopo, expiración, simulación read-only y export.
 * CONSUMEN el modelo y el motor RBAC (PR-006) — Perfil/Permiso/PerfilPermiso/
 * UsuarioPermiso + resolver — sin alterarlos. Todo cambio de permiso es sensible
 * ⇒ auditado (G-07/CRIT-11) con IP y motivo. Los perfiles `esSistema` (ADMIN/
 * USER) quedan protegidos: no se editan/renombran/borran desde la UI.
 */

export type PerfilRow = {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  esSistema: boolean;
  activo: boolean;
  permisosCount: number;
  usuariosCount: number;
};

export type PermisoCatalogoItem = {
  id: string;
  clave: string;
  dimension: DimensionPermiso;
  descripcion: string | null;
};

export type MatrizData = {
  perfiles: PerfilRow[];
  permisos: PermisoCatalogoItem[];
  grants: Array<{ perfilId: string; permisoId: string }>;
};

export type OverrideRow = {
  permisoId: string;
  clave: string;
  dimension: DimensionPermiso;
  concedido: boolean;
  ambito: unknown;
  expiraEn: Date | null;
};

export type PermisosActionResult = { ok: true } | { ok: false; error: string };
export type ExportMatrizResult =
  | { ok: true; csv: string; filename: string }
  | { ok: false; error: string };
export type PreviewResult =
  | { ok: true; claves: string[]; esAdminTotal: boolean }
  | { ok: false; error: string };

// ============================================================
// Lecturas
// ============================================================

export async function listarPerfiles(): Promise<PerfilRow[]> {
  const rows = await db.perfil.findMany({
    orderBy: [{ esSistema: "desc" }, { codigo: "asc" }],
    select: {
      id: true,
      codigo: true,
      nombre: true,
      descripcion: true,
      esSistema: true,
      activo: true,
      _count: { select: { permisos: true, usuarios: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    codigo: r.codigo,
    nombre: r.nombre,
    descripcion: r.descripcion,
    esSistema: r.esSistema,
    activo: r.activo,
    permisosCount: r._count.permisos,
    usuariosCount: r._count.usuarios,
  }));
}

export async function listarCatalogoPermisos(): Promise<PermisoCatalogoItem[]> {
  const rows = await db.permiso.findMany({
    orderBy: [{ dimension: "asc" }, { clave: "asc" }],
    select: { id: true, clave: true, dimension: true, descripcion: true },
  });
  return rows.map((r) => ({
    id: r.id,
    clave: r.clave,
    dimension: r.dimension,
    descripcion: r.descripcion,
  }));
}

async function cargarMatriz(): Promise<MatrizData> {
  const [perfiles, permisos, grants] = await Promise.all([
    listarPerfiles(),
    listarCatalogoPermisos(),
    db.perfilPermiso.findMany({ select: { perfilId: true, permisoId: true } }),
  ]);
  return { perfiles, permisos, grants };
}

export async function getMatrizPerfiles(): Promise<MatrizData> {
  return cargarMatriz();
}

export async function getOverridesUsuario(userId: string): Promise<OverrideRow[]> {
  const rows = await db.usuarioPermiso.findMany({
    where: { usuarioId: userId },
    orderBy: { permiso: { clave: "asc" } },
    select: {
      permisoId: true,
      concedido: true,
      ambito: true,
      expiraEn: true,
      permiso: { select: { clave: true, dimension: true } },
    },
  });
  return rows.map((r) => ({
    permisoId: r.permisoId,
    clave: r.permiso.clave,
    dimension: r.permiso.dimension,
    concedido: r.concedido,
    ambito: r.ambito,
    expiraEn: r.expiraEn,
  }));
}

// ============================================================
// Matriz de perfil — editar grants (bulk, por perfil, en FloatingWorkWindow)
// ============================================================

const guardarPermisosSchema = z.object({
  permisoIds: z.array(z.string()).default([]),
  motivo: z.string().trim().optional(),
});
export type GuardarPermisosInput = z.input<typeof guardarPermisosSchema>;

type GrantsTx = Pick<Prisma.TransactionClient, "perfilPermiso">;

async function aplicarGrants(
  tx: GrantsTx,
  perfilId: string,
  toAdd: string[],
  toRemove: string[],
): Promise<void> {
  if (toRemove.length > 0) {
    await tx.perfilPermiso.deleteMany({ where: { perfilId, permisoId: { in: toRemove } } });
  }
  if (toAdd.length > 0) {
    await tx.perfilPermiso.createMany({
      data: toAdd.map((permisoId) => ({ perfilId, permisoId })),
      skipDuplicates: true,
    });
  }
}

export async function guardarPermisosPerfilAction(
  perfilId: string,
  raw: GuardarPermisosInput,
): Promise<PermisosActionResult> {
  const guard = await requireAdminAction();
  if (!guard.ok) return guard;
  if (!perfilId) return { ok: false, error: "Id requerido." };

  const parsed = guardarPermisosSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const perfil = await db.perfil.findUnique({
    where: { id: perfilId },
    select: { esSistema: true, permisos: { select: { permisoId: true } } },
  });
  if (!perfil) return { ok: false, error: "El perfil no existe." };
  if (perfil.esSistema) return { ok: false, error: "Los perfiles de sistema no se editan." };

  const deseados = new Set(parsed.data.permisoIds);
  const actuales = new Set(perfil.permisos.map((p) => p.permisoId));
  const toAdd = [...deseados].filter((x) => !actuales.has(x));
  const toRemove = [...actuales].filter((x) => !deseados.has(x));
  if (toAdd.length === 0 && toRemove.length === 0) return { ok: true };

  const ip = await getRequestIp();
  try {
    await db.$transaction(async (tx) => {
      await aplicarGrants(tx, perfilId, toAdd, toRemove);
      await registrarAuditoria(tx, {
        tabla: "Perfil",
        registroId: perfilId,
        accion: "UPDATE",
        usuarioId: guard.userId,
        datosAnteriores: { permisoIds: [...actuales] },
        datosNuevos: { permisoIds: [...deseados] },
        motivo: parsed.data.motivo ?? null,
        origen: "MANUAL",
        ip,
      });
    });
    revalidatePath("/sistema/permisos");
    return { ok: true };
  } catch (err) {
    console.error("guardarPermisosPerfilAction falló", err);
    return { ok: false, error: "Error inesperado al guardar los permisos." };
  }
}

// ============================================================
// Perfiles — crear / copiar / actualizar / activar
// ============================================================

const codigoSchema = z
  .string()
  .trim()
  .min(2, "El código debe tener al menos 2 caracteres.")
  .max(40, "El código es demasiado largo.")
  .transform((s) => s.toUpperCase())
  .refine((s) => /^[A-Z0-9_]+$/.test(s), "Código inválido (solo A-Z, 0-9 y _).");

const optionalDescripcion = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null));

const crearPerfilSchema = z.object({
  codigo: codigoSchema,
  nombre: z.string().trim().min(1, "El nombre es obligatorio."),
  descripcion: optionalDescripcion,
});
export type CrearPerfilInput = z.input<typeof crearPerfilSchema>;

const copiarPerfilSchema = z.object({
  codigo: codigoSchema,
  nombre: z.string().trim().min(1, "El nombre es obligatorio."),
});
export type CopiarPerfilInput = z.input<typeof copiarPerfilSchema>;

const actualizarPerfilSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio."),
  descripcion: optionalDescripcion,
});
export type ActualizarPerfilInput = z.input<typeof actualizarPerfilSchema>;

function mapPerfilError(err: unknown): { ok: false; error: string } {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return { ok: false, error: "Ya existe un perfil con ese código." };
    if (err.code === "P2025") return { ok: false, error: "El perfil no existe." };
  }
  console.error("perfil action falló", err);
  return { ok: false, error: "Error inesperado en la operación de perfil." };
}

export async function crearPerfilAction(raw: CrearPerfilInput): Promise<PermisosActionResult> {
  const guard = await requireAdminAction();
  if (!guard.ok) return guard;

  const parsed = crearPerfilSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const ip = await getRequestIp();
  try {
    await db.$transaction(async (tx) => {
      const perfil = await tx.perfil.create({
        data: { ...parsed.data, esSistema: false },
        select: { id: true, codigo: true, nombre: true, descripcion: true },
      });
      await registrarAuditoria(tx, {
        tabla: "Perfil",
        registroId: perfil.id,
        accion: "CREATE",
        usuarioId: guard.userId,
        datosNuevos: perfil,
        origen: "MANUAL",
        ip,
      });
    });
    revalidatePath("/sistema/permisos");
    return { ok: true };
  } catch (err) {
    return mapPerfilError(err);
  }
}

export async function copiarPerfilAction(
  sourceId: string,
  raw: CopiarPerfilInput,
): Promise<PermisosActionResult> {
  const guard = await requireAdminAction();
  if (!guard.ok) return guard;
  if (!sourceId) return { ok: false, error: "Id requerido." };

  const parsed = copiarPerfilSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const source = await db.perfil.findUnique({
    where: { id: sourceId },
    select: { id: true, permisos: { select: { permisoId: true } } },
  });
  if (!source) return { ok: false, error: "El perfil de origen no existe." };

  const ip = await getRequestIp();
  try {
    await db.$transaction(async (tx) => {
      const nuevo = await tx.perfil.create({
        data: { codigo: parsed.data.codigo, nombre: parsed.data.nombre, esSistema: false },
        select: { id: true, codigo: true, nombre: true },
      });
      if (source.permisos.length > 0) {
        await tx.perfilPermiso.createMany({
          data: source.permisos.map((p) => ({ perfilId: nuevo.id, permisoId: p.permisoId })),
          skipDuplicates: true,
        });
      }
      await registrarAuditoria(tx, {
        tabla: "Perfil",
        registroId: nuevo.id,
        accion: "CREATE",
        usuarioId: guard.userId,
        datosNuevos: { ...nuevo, copiadoDe: sourceId, permisos: source.permisos.length },
        origen: "MANUAL",
        ip,
      });
    });
    revalidatePath("/sistema/permisos");
    return { ok: true };
  } catch (err) {
    return mapPerfilError(err);
  }
}

export async function actualizarPerfilAction(
  id: string,
  raw: ActualizarPerfilInput,
): Promise<PermisosActionResult> {
  const guard = await requireAdminAction();
  if (!guard.ok) return guard;
  if (!id) return { ok: false, error: "Id requerido." };

  const parsed = actualizarPerfilSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const antes = await db.perfil.findUnique({
    where: { id },
    select: { esSistema: true, nombre: true, descripcion: true },
  });
  if (!antes) return { ok: false, error: "El perfil no existe." };
  if (antes.esSistema) return { ok: false, error: "Los perfiles de sistema no se modifican." };

  const ip = await getRequestIp();
  try {
    await db.$transaction(async (tx) => {
      const despues = await tx.perfil.update({
        where: { id },
        data: parsed.data,
        select: { nombre: true, descripcion: true },
      });
      await registrarAuditoria(tx, {
        tabla: "Perfil",
        registroId: id,
        accion: "UPDATE",
        usuarioId: guard.userId,
        datosAnteriores: { nombre: antes.nombre, descripcion: antes.descripcion },
        datosNuevos: despues,
        origen: "MANUAL",
        ip,
      });
    });
    revalidatePath("/sistema/permisos");
    return { ok: true };
  } catch (err) {
    return mapPerfilError(err);
  }
}

export async function setPerfilActivoAction(
  id: string,
  activo: boolean,
  motivo?: string,
): Promise<PermisosActionResult> {
  const guard = await requireAdminAction();
  if (!guard.ok) return guard;
  if (!id) return { ok: false, error: "Id requerido." };

  const antes = await db.perfil.findUnique({
    where: { id },
    select: { esSistema: true, activo: true },
  });
  if (!antes) return { ok: false, error: "El perfil no existe." };
  if (antes.esSistema) return { ok: false, error: "Los perfiles de sistema no se modifican." };

  const ip = await getRequestIp();
  try {
    await db.$transaction(async (tx) => {
      await tx.perfil.update({ where: { id }, data: { activo }, select: { id: true } });
      await registrarAuditoria(tx, {
        tabla: "Perfil",
        registroId: id,
        accion: "UPDATE",
        usuarioId: guard.userId,
        datosAnteriores: { activo: antes.activo },
        datosNuevos: { activo },
        motivo: motivo ?? null,
        origen: "MANUAL",
        ip,
      });
    });
    revalidatePath("/sistema/permisos");
    return { ok: true };
  } catch (err) {
    return mapPerfilError(err);
  }
}

// ============================================================
// Overrides por usuario (grant/revoke + ámbito + expiración)
// ============================================================

const overrideSchema = z.object({
  permisoId: z.string().min(1, "Permiso requerido."),
  concedido: z.boolean(),
  ambito: z.string().trim().optional(),
  expiraEn: z.string().trim().optional(),
  motivo: z.string().trim().min(1, "El motivo es obligatorio."),
});
export type OverrideInput = z.input<typeof overrideSchema>;

type AmbitoParsed = Prisma.InputJsonValue | typeof Prisma.JsonNull;

// Parsea ámbito (JSON opcional) + expiración (fecha opcional) y valida que el
// permiso y el usuario existan. Extraído para acotar la complejidad de la action.
async function prepararOverride(
  userId: string,
  data: z.infer<typeof overrideSchema>,
): Promise<
  { ok: true; ambito: AmbitoParsed; expiraEn: Date | null } | { ok: false; error: string }
> {
  let ambito: AmbitoParsed = Prisma.JsonNull;
  if (data.ambito && data.ambito.length > 0) {
    try {
      ambito = JSON.parse(data.ambito) as Prisma.InputJsonValue;
    } catch {
      return { ok: false, error: "El ámbito debe ser JSON válido (o quedar vacío)." };
    }
  }

  let expiraEn: Date | null = null;
  if (data.expiraEn && data.expiraEn.length > 0) {
    const d = new Date(data.expiraEn);
    if (Number.isNaN(d.getTime())) return { ok: false, error: "Fecha de expiración inválida." };
    expiraEn = d;
  }

  const [permiso, usuario] = await Promise.all([
    db.permiso.findUnique({ where: { id: data.permisoId }, select: { id: true } }),
    db.user.findUnique({ where: { id: userId }, select: { id: true } }),
  ]);
  if (!usuario) return { ok: false, error: "El usuario no existe." };
  if (!permiso) return { ok: false, error: "El permiso no existe." };

  return { ok: true, ambito, expiraEn };
}

export async function setOverrideUsuarioAction(
  userId: string,
  raw: OverrideInput,
): Promise<PermisosActionResult> {
  const guard = await requireAdminAction();
  if (!guard.ok) return guard;
  if (!userId) return { ok: false, error: "Id requerido." };

  const parsed = overrideSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const prep = await prepararOverride(userId, parsed.data);
  if (!prep.ok) return prep;

  const { permisoId, concedido, motivo } = parsed.data;
  const ip = await getRequestIp();
  try {
    await db.$transaction(async (tx) => {
      const previo = await tx.usuarioPermiso.findUnique({
        where: { usuarioId_permisoId: { usuarioId: userId, permisoId } },
        select: { concedido: true, expiraEn: true },
      });
      await tx.usuarioPermiso.upsert({
        where: { usuarioId_permisoId: { usuarioId: userId, permisoId } },
        update: { concedido, ambito: prep.ambito, expiraEn: prep.expiraEn },
        create: {
          usuarioId: userId,
          permisoId,
          concedido,
          ambito: prep.ambito,
          expiraEn: prep.expiraEn,
        },
      });
      await registrarAuditoria(tx, {
        tabla: "UsuarioPermiso",
        registroId: `${userId}:${permisoId}`,
        accion: previo ? "UPDATE" : "CREATE",
        usuarioId: guard.userId,
        datosAnteriores: previo
          ? { concedido: previo.concedido, expiraEn: previo.expiraEn }
          : undefined,
        datosNuevos: { concedido, expiraEn: prep.expiraEn },
        motivo,
        origen: "MANUAL",
        ip,
      });
    });
    revalidatePath(`/sistema/usuarios/${userId}`);
    return { ok: true };
  } catch (err) {
    console.error("setOverrideUsuarioAction falló", err);
    return { ok: false, error: "Error inesperado al guardar el override." };
  }
}

const quitarOverrideSchema = z.object({
  permisoId: z.string().min(1, "Permiso requerido."),
  motivo: z.string().trim().min(1, "El motivo es obligatorio."),
});
export type QuitarOverrideInput = z.input<typeof quitarOverrideSchema>;

export async function quitarOverrideUsuarioAction(
  userId: string,
  raw: QuitarOverrideInput,
): Promise<PermisosActionResult> {
  const guard = await requireAdminAction();
  if (!guard.ok) return guard;
  if (!userId) return { ok: false, error: "Id requerido." };

  const parsed = quitarOverrideSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const { permisoId, motivo } = parsed.data;

  const previo = await db.usuarioPermiso.findUnique({
    where: { usuarioId_permisoId: { usuarioId: userId, permisoId } },
    select: { concedido: true },
  });
  if (!previo) return { ok: false, error: "El override no existe." };

  const ip = await getRequestIp();
  try {
    await db.$transaction(async (tx) => {
      await tx.usuarioPermiso.delete({
        where: { usuarioId_permisoId: { usuarioId: userId, permisoId } },
      });
      await registrarAuditoria(tx, {
        tabla: "UsuarioPermiso",
        registroId: `${userId}:${permisoId}`,
        accion: "DELETE",
        usuarioId: guard.userId,
        datosAnteriores: { concedido: previo.concedido },
        motivo,
        origen: "MANUAL",
        ip,
      });
    });
    revalidatePath(`/sistema/usuarios/${userId}`);
    return { ok: true };
  } catch (err) {
    console.error("quitarOverrideUsuarioAction falló", err);
    return { ok: false, error: "Error inesperado al quitar el override." };
  }
}

// ============================================================
// Simular (preview read-only) — NO es impersonation/login-as
// ============================================================

// Calcula el set EFECTIVO de claves que el usuario tendría con RBAC, usando el
// MISMO resolver real del motor (read-only; no muta sesión/JWT ni hace login).
// Refleja la configuración de permisos (perfil + overrides + expiración),
// independiente del valor actual de la flag RBAC_ENABLED. Auditado como
// VISUALIZACION_SENSIBLE (PERM-01: toda simulación se audita).
export async function previewPermisosEfectivosAction(userId: string): Promise<PreviewResult> {
  const guard = await requireAdminAction();
  if (!guard.ok) return guard;
  if (!userId) return { ok: false, error: "Id requerido." };

  const u = await loadUserForPermiso(userId);
  if (!u) return { ok: false, error: "El usuario no existe." };

  const esAdminTotal = isAdminFastPath(u);
  const claves = esAdminTotal ? [...Object.values(PERMISOS)] : [...resolveEffectivePermisos(u)];

  const ip = await getRequestIp();
  try {
    await db.$transaction(async (tx) => {
      await registrarAuditoria(tx, {
        tabla: "User",
        registroId: userId,
        accion: "VISUALIZACION_SENSIBLE",
        usuarioId: guard.userId,
        datosNuevos: { simulacion: true, claves: claves.length },
        origen: "MANUAL",
        ip,
      });
    });
  } catch (err) {
    // El preview es read-only: si la auditoría falla, no rompemos la simulación.
    console.error("audit simular falló", err);
  }

  return { ok: true, claves, esAdminTotal };
}

// ============================================================
// Exportar matriz (CSV) — honra el permiso de export, auditado
// ============================================================

function construirColumnasMatriz(
  permisos: PermisoCatalogoItem[],
  grantSet: Set<string>,
): ExportColumn<PerfilRow>[] {
  const base: ExportColumn<PerfilRow>[] = [
    { header: "Perfil", value: (p) => p.nombre },
    { header: "Código", value: (p) => p.codigo },
  ];
  const claveCols = permisos.map(
    (perm): ExportColumn<PerfilRow> => ({
      header: perm.clave,
      value: (p) => (grantSet.has(`${p.id}:${perm.id}`) ? "✓" : ""),
    }),
  );
  return [...base, ...claveCols];
}

export async function exportarMatrizAction(): Promise<ExportMatrizResult> {
  const guard = await requireAdminAction();
  if (!guard.ok) return guard;

  const { perfiles, permisos, grants } = await cargarMatriz();
  const grantSet = new Set(grants.map((g) => `${g.perfilId}:${g.permisoId}`));
  const csv = toCsv(construirColumnasMatriz(permisos, grantSet), perfiles);

  const ip = await getRequestIp();
  try {
    await db.$transaction(async (tx) => {
      await registrarAuditoria(tx, {
        tabla: "Perfil",
        registroId: "matriz",
        accion: "EXPORTACION",
        usuarioId: guard.userId,
        datosNuevos: { perfiles: perfiles.length, permisos: permisos.length },
        origen: "MANUAL",
        ip,
      });
    });
  } catch (err) {
    console.error("audit export matriz falló", err);
  }

  return { ok: true, csv, filename: "matriz-permisos.csv" };
}
