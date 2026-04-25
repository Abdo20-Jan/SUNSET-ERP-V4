"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { money, toDecimal, Decimal, type MoneyInput } from "@/lib/decimal";

export type ProductoRow = {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  marca: string | null;
  modelo: string | null;
  medida: string | null;
  ncm: string | null;
  unidad: string;
  diePorcentaje: string;
  precioVenta: string;
  costoPromedio: string;
  stockActual: number;
  stockMinimo: number;
  activo: boolean;
};

function percent4(value: MoneyInput): Prisma.Decimal {
  return new Prisma.Decimal(
    toDecimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
  );
}

export async function listarProductos(): Promise<ProductoRow[]> {
  const rows = await db.producto.findMany({
    orderBy: { codigo: "asc" },
    select: {
      id: true,
      codigo: true,
      nombre: true,
      descripcion: true,
      marca: true,
      modelo: true,
      medida: true,
      ncm: true,
      unidad: true,
      diePorcentaje: true,
      precioVenta: true,
      costoPromedio: true,
      stockActual: true,
      stockMinimo: true,
      activo: true,
    },
  });

  return rows.map((p) => ({
    id: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    descripcion: p.descripcion,
    marca: p.marca,
    modelo: p.modelo,
    medida: p.medida,
    ncm: p.ncm,
    unidad: p.unidad,
    diePorcentaje: p.diePorcentaje.toFixed(4),
    precioVenta: p.precioVenta.toFixed(2),
    costoPromedio: p.costoPromedio.toFixed(2),
    stockActual: p.stockActual,
    stockMinimo: p.stockMinimo,
    activo: p.activo,
  }));
}

const nullableStr = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : null));

const productoCrearSchema = z.object({
  codigo: z
    .string()
    .trim()
    .min(1, "El código es obligatorio.")
    .transform((v) => v.toUpperCase()),
  nombre: z.string().trim().min(1, "El nombre es obligatorio."),
  descripcion: nullableStr,
  marca: nullableStr,
  modelo: nullableStr,
  medida: nullableStr,
  ncm: nullableStr,
  unidad: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : "UN")),
  diePorcentaje: z.coerce
    .number()
    .finite("DIE% inválido.")
    .nonnegative("DIE% debe ser ≥ 0.")
    .default(0),
  precioVenta: z.coerce
    .number()
    .finite("Precio inválido.")
    .nonnegative("El precio debe ser ≥ 0.")
    .default(0),
  stockMinimo: z.coerce
    .number()
    .int("Stock mínimo debe ser entero.")
    .nonnegative("Stock mínimo debe ser ≥ 0.")
    .default(0),
  activo: z.boolean().optional().default(true),
});

export type ProductoInput = z.input<typeof productoCrearSchema>;

export type ProductoActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function crearProductoAction(
  raw: ProductoInput,
): Promise<ProductoActionResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado." };

  const parsed = productoCrearSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Datos inválidos." };
  }

  const {
    codigo,
    nombre,
    descripcion,
    marca,
    modelo,
    medida,
    ncm,
    unidad,
    diePorcentaje,
    precioVenta,
    stockMinimo,
    activo,
  } = parsed.data;

  try {
    const created = await db.producto.create({
      data: {
        codigo,
        nombre,
        descripcion,
        marca,
        modelo,
        medida,
        ncm,
        unidad,
        diePorcentaje: percent4(diePorcentaje),
        precioVenta: money(precioVenta),
        stockMinimo,
        activo,
      },
      select: { id: true },
    });
    revalidatePath("/maestros/productos");
    revalidatePath("/maestros");
    return { ok: true, id: created.id };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return { ok: false, error: "Ya existe un producto con ese código." };
    }
    console.error("crearProductoAction failed", err);
    return { ok: false, error: "Error inesperado al crear el producto." };
  }
}

export async function actualizarProductoAction(
  id: string,
  raw: ProductoInput,
): Promise<ProductoActionResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado." };
  if (!id) return { ok: false, error: "Id requerido." };

  const parsed = productoCrearSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Datos inválidos." };
  }

  const {
    codigo,
    nombre,
    descripcion,
    marca,
    modelo,
    medida,
    ncm,
    unidad,
    diePorcentaje,
    precioVenta,
    stockMinimo,
    activo,
  } = parsed.data;

  try {
    const updated = await db.producto.update({
      where: { id },
      data: {
        codigo,
        nombre,
        descripcion,
        marca,
        modelo,
        medida,
        ncm,
        unidad,
        diePorcentaje: percent4(diePorcentaje),
        precioVenta: money(precioVenta),
        stockMinimo,
        activo,
      },
      select: { id: true },
    });
    revalidatePath("/maestros/productos");
    revalidatePath("/maestros");
    return { ok: true, id: updated.id };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") {
        return { ok: false, error: "Ya existe un producto con ese código." };
      }
      if (err.code === "P2025") {
        return { ok: false, error: "El producto no existe." };
      }
    }
    console.error("actualizarProductoAction failed", err);
    return { ok: false, error: "Error inesperado al actualizar el producto." };
  }
}

export async function eliminarProductoAction(
  id: string,
): Promise<{ ok: true; softDeleted: boolean } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado." };
  if (!id) return { ok: false, error: "Id requerido." };

  const [embarqueCount, compraCount, ventaCount, stockCount] = await Promise.all([
    db.itemEmbarque.count({ where: { productoId: id } }),
    db.itemCompra.count({ where: { productoId: id } }),
    db.itemVenta.count({ where: { productoId: id } }),
    db.movimientoStock.count({ where: { productoId: id } }),
  ]);

  const tieneReferencias =
    embarqueCount > 0 || compraCount > 0 || ventaCount > 0 || stockCount > 0;

  try {
    if (tieneReferencias) {
      await db.producto.update({
        where: { id },
        data: { activo: false },
        select: { id: true },
      });
      revalidatePath("/maestros/productos");
      revalidatePath("/maestros");
      return { ok: true, softDeleted: true };
    }
    await db.producto.delete({ where: { id } });
    revalidatePath("/maestros/productos");
    revalidatePath("/maestros");
    return { ok: true, softDeleted: false };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2025"
    ) {
      return { ok: false, error: "El producto no existe." };
    }
    console.error("eliminarProductoAction failed", err);
    return { ok: false, error: "Error inesperado al eliminar el producto." };
  }
}
