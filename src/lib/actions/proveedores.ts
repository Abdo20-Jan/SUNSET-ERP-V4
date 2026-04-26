"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  crearCuentaParaEntidad,
  rangoGastoByTipo,
  rangoProveedorByTipo,
} from "@/lib/services/cuenta-auto";
import {
  ConceptoRG830,
  CuentaCategoria,
  CuentaTipo,
  Prisma,
  TipoProveedor,
} from "@/generated/prisma/client";

export type ProveedorRow = {
  id: string;
  nombre: string;
  cuit: string | null;
  tipo: string;
  tipoProveedor: TipoProveedor;
  conceptoRG830: ConceptoRG830 | null;
  pais: string;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
  estado: string;
  cuentaContableId: number | null;
  cuentaContableCodigo: string | null;
  cuentaContableNombre: string | null;
  cuentaGastoContableId: number | null;
  cuentaGastoContableCodigo: string | null;
  cuentaGastoContableNombre: string | null;
};

export type CuentaContableOption = {
  id: number;
  codigo: string;
  nombre: string;
};

const CUENTAS_PROVEEDORES_PREFIX = "2.1.1.";

export async function listarProveedores(): Promise<ProveedorRow[]> {
  const rows = await db.proveedor.findMany({
    orderBy: { nombre: "asc" },
    select: {
      id: true,
      nombre: true,
      cuit: true,
      tipo: true,
      tipoProveedor: true,
      conceptoRG830: true,
      pais: true,
      direccion: true,
      telefono: true,
      email: true,
      estado: true,
      cuentaContableId: true,
      cuentaContable: { select: { codigo: true, nombre: true } },
      cuentaGastoContableId: true,
      cuentaGastoContable: { select: { codigo: true, nombre: true } },
    },
  });

  return rows.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    cuit: p.cuit,
    tipo: p.tipo,
    tipoProveedor: p.tipoProveedor,
    conceptoRG830: p.conceptoRG830,
    pais: p.pais,
    direccion: p.direccion,
    telefono: p.telefono,
    email: p.email,
    estado: p.estado,
    cuentaContableId: p.cuentaContableId,
    cuentaContableCodigo: p.cuentaContable?.codigo ?? null,
    cuentaContableNombre: p.cuentaContable?.nombre ?? null,
    cuentaGastoContableId: p.cuentaGastoContableId,
    cuentaGastoContableCodigo: p.cuentaGastoContable?.codigo ?? null,
    cuentaGastoContableNombre: p.cuentaGastoContable?.nombre ?? null,
  }));
}

export async function listarCuentasContablesParaProveedor(): Promise<
  CuentaContableOption[]
> {
  const cuentas = await db.cuentaContable.findMany({
    where: {
      tipo: CuentaTipo.ANALITICA,
      activa: true,
      codigo: { startsWith: CUENTAS_PROVEEDORES_PREFIX },
    },
    orderBy: { codigo: "asc" },
    select: { id: true, codigo: true, nombre: true },
  });
  return cuentas;
}

// Cuentas elegibles como contrapartida de gasto/activo cuando se factura
// del proveedor: ANALITICAS activas categoría EGRESO (5.x) o ACTIVO (1.x —
// para capitalizar en mercaderías en tránsito).
export async function listarCuentasContablesParaGastoProveedor(): Promise<
  CuentaContableOption[]
> {
  const cuentas = await db.cuentaContable.findMany({
    where: {
      tipo: CuentaTipo.ANALITICA,
      activa: true,
      categoria: { in: [CuentaCategoria.EGRESO, CuentaCategoria.ACTIVO] },
    },
    orderBy: { codigo: "asc" },
    select: { id: true, codigo: true, nombre: true },
  });
  return cuentas;
}

const nullableStr = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : null));

const proveedorBaseSchema = z
  .object({
    nombre: z.string().trim().min(1, "El nombre es obligatorio."),
    cuit: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
    tipo: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : "otro")),
    tipoProveedor: z
      .nativeEnum(TipoProveedor)
      .default(TipoProveedor.MERCADERIA_LOCAL),
    conceptoRG830: z.nativeEnum(ConceptoRG830).optional().nullable(),
    pais: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim().toUpperCase() : "AR")),
    direccion: nullableStr,
    telefono: nullableStr,
    email: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : null))
      .refine(
        (v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
        "Email inválido.",
      ),
    estado: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : "activo"))
      .refine(
        (v) => v === "activo" || v === "inactivo",
        "Estado debe ser 'activo' o 'inactivo'.",
      ),
    cuentaContableId: z
      .number()
      .int()
      .positive()
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    cuentaGastoContableId: z
      .number()
      .int()
      .positive()
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    crearCuentaAuto: z.boolean().optional().default(false),
    crearCuentaGastoAuto: z.boolean().optional().default(false),
  });
  // CUIT siempre opcional — tanto para nacionales como extranjeros.

export type ProveedorInput = z.input<typeof proveedorBaseSchema>;

export type ProveedorActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

async function validarCuentaContable(
  id: number | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (id === null) return { ok: true };
  const cuenta = await db.cuentaContable.findUnique({
    where: { id },
    select: { codigo: true, tipo: true, activa: true },
  });
  if (!cuenta) {
    return { ok: false, error: "La cuenta contable seleccionada no existe." };
  }
  if (!cuenta.activa) {
    return { ok: false, error: `La cuenta ${cuenta.codigo} está inactiva.` };
  }
  if (cuenta.tipo !== CuentaTipo.ANALITICA) {
    return {
      ok: false,
      error: "La cuenta contable debe ser ANALITICA (no sintética).",
    };
  }
  return { ok: true };
}

export async function crearProveedorAction(
  raw: ProveedorInput,
): Promise<ProveedorActionResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado." };

  const parsed = proveedorBaseSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Datos inválidos." };
  }

  const cuentaCheck = await validarCuentaContable(parsed.data.cuentaContableId);
  if (!cuentaCheck.ok) return cuentaCheck;
  const gastoCheck = await validarCuentaContable(parsed.data.cuentaGastoContableId);
  if (!gastoCheck.ok) return gastoCheck;

  try {
    const created = await db.$transaction(async (tx) => {
      let cuentaContableId = parsed.data.cuentaContableId;
      if (cuentaContableId === null && parsed.data.crearCuentaAuto) {
        const cuenta = await crearCuentaParaEntidad(
          tx,
          rangoProveedorByTipo(parsed.data.tipoProveedor),
          parsed.data.nombre,
        );
        cuentaContableId = cuenta.id;
      }
      let cuentaGastoContableId = parsed.data.cuentaGastoContableId;
      if (cuentaGastoContableId === null && parsed.data.crearCuentaGastoAuto) {
        const rangoGasto = rangoGastoByTipo(parsed.data.tipoProveedor);
        if (rangoGasto) {
          const cuentaGasto = await crearCuentaParaEntidad(
            tx,
            rangoGasto,
            parsed.data.nombre,
          );
          cuentaGastoContableId = cuentaGasto.id;
        }
      }
      const {
        crearCuentaAuto: _ignore,
        crearCuentaGastoAuto: _ignore2,
        ...rest
      } = parsed.data;
      void _ignore;
      void _ignore2;
      return tx.proveedor.create({
        data: { ...rest, cuentaContableId, cuentaGastoContableId },
        select: { id: true },
      });
    });
    revalidatePath("/maestros/proveedores");
    revalidatePath("/maestros");
    revalidatePath("/contabilidad/cuentas");
    return { ok: true, id: created.id };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return { ok: false, error: "Ya existe un proveedor con ese CUIT." };
    }
    if (err instanceof Error && err.message.startsWith("No hay códigos")) {
      return { ok: false, error: err.message };
    }
    console.error("crearProveedorAction failed", err);
    return { ok: false, error: "Error inesperado al crear el proveedor." };
  }
}

export async function actualizarProveedorAction(
  id: string,
  raw: ProveedorInput,
): Promise<ProveedorActionResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado." };
  if (!id) return { ok: false, error: "Id requerido." };

  const parsed = proveedorBaseSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Datos inválidos." };
  }

  const cuentaCheck = await validarCuentaContable(parsed.data.cuentaContableId);
  if (!cuentaCheck.ok) return cuentaCheck;
  const gastoCheck = await validarCuentaContable(parsed.data.cuentaGastoContableId);
  if (!gastoCheck.ok) return gastoCheck;

  try {
    const updated = await db.$transaction(async (tx) => {
      let cuentaGastoContableId = parsed.data.cuentaGastoContableId;
      if (cuentaGastoContableId === null && parsed.data.crearCuentaGastoAuto) {
        const rangoGasto = rangoGastoByTipo(parsed.data.tipoProveedor);
        if (rangoGasto) {
          const cuentaGasto = await crearCuentaParaEntidad(
            tx,
            rangoGasto,
            parsed.data.nombre,
          );
          cuentaGastoContableId = cuentaGasto.id;
        }
      }
      const {
        crearCuentaAuto: _ignore,
        crearCuentaGastoAuto: _ignore2,
        ...rest
      } = parsed.data;
      void _ignore;
      void _ignore2;
      return tx.proveedor.update({
        where: { id },
        data: { ...rest, cuentaGastoContableId },
        select: { id: true },
      });
    });
    revalidatePath("/maestros/proveedores");
    revalidatePath("/maestros");
    return { ok: true, id: updated.id };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") {
        return { ok: false, error: "Ya existe un proveedor con ese CUIT." };
      }
      if (err.code === "P2025") {
        return { ok: false, error: "El proveedor no existe." };
      }
    }
    console.error("actualizarProveedorAction failed", err);
    return { ok: false, error: "Error inesperado al actualizar el proveedor." };
  }
}

export async function eliminarProveedorAction(
  id: string,
): Promise<{ ok: true; softDeleted: boolean } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado." };
  if (!id) return { ok: false, error: "Id requerido." };

  const [embarquesCount, comprasCount] = await Promise.all([
    db.embarque.count({ where: { proveedorId: id } }),
    db.compra.count({ where: { proveedorId: id } }),
  ]);

  const tieneReferencias = embarquesCount > 0 || comprasCount > 0;

  try {
    if (tieneReferencias) {
      await db.proveedor.update({
        where: { id },
        data: { estado: "inactivo" },
        select: { id: true },
      });
      revalidatePath("/maestros/proveedores");
      revalidatePath("/maestros");
      return { ok: true, softDeleted: true };
    }
    await db.proveedor.delete({ where: { id } });
    revalidatePath("/maestros/proveedores");
    revalidatePath("/maestros");
    return { ok: true, softDeleted: false };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2025"
    ) {
      return { ok: false, error: "El proveedor no existe." };
    }
    console.error("eliminarProveedorAction failed", err);
    return { ok: false, error: "Error inesperado al eliminar el proveedor." };
  }
}
