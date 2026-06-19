"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { money, toDecimal, Decimal, type MoneyInput } from "@/lib/decimal";
import { parseSortParams, buildOrderBy, type SortDir } from "@/lib/table-sort";

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
  return new Prisma.Decimal(toDecimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4));
}

// Keys lógicas habilitadas para ordenar (allowlist) → mapean al campo real del
// modelo. NUNCA se pasa el nombre de columna crudo a Prisma: `buildOrderBy`
// solo lee de este mapa y `parseSortParams` rechaza keys fuera de `ALLOWED`.
const PRODUCTOS_SORT_FIELD_MAP = {
  codigo: "codigo",
  nombre: "nombre",
  marca: "marca",
  stock: "stockActual",
  precio: "precioVenta",
  estado: "activo",
} as const;
const PRODUCTOS_SORT_ALLOWED = Object.keys(PRODUCTOS_SORT_FIELD_MAP);
const PRODUCTOS_SORT_DEFAULT = { sort: "codigo", dir: "asc" } as const;

// `select` compartido entre la lista paginada y el export (mismo shape de fila).
const PRODUCTO_ROW_SELECT = {
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
} satisfies Prisma.ProductoSelect;

type ProductoRowRaw = Prisma.ProductoGetPayload<{ select: typeof PRODUCTO_ROW_SELECT }>;

function mapProductoRow(p: ProductoRowRaw): ProductoRow {
  return {
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
  };
}

// Construye el `where` a partir de {q, marca}. Reutilizado por `listarProductos`
// (paginado) y `listarProductosParaExport` (todas las filas del set filtrado).
function buildProductosWhere(opts: { q?: string; marca?: string }): Prisma.ProductoWhereInput {
  const q = opts.q?.trim();
  const marca = opts.marca?.trim();

  const where: Prisma.ProductoWhereInput = {};
  if (q) {
    where.OR = [
      { codigo: { contains: q, mode: "insensitive" } },
      { nombre: { contains: q, mode: "insensitive" } },
    ];
  }
  if (marca && marca !== "todas") {
    where.marca = marca;
  }
  return where;
}

export type ListarProductosOpts = {
  q?: string;
  marca?: string;
  page?: number;
  perPage?: number;
  sort?: string;
  dir?: SortDir;
};

export type ListarProductosResult = {
  rows: ProductoRow[];
  total: number;
  marcas: string[];
};

export async function listarProductos(
  opts: ListarProductosOpts = {},
): Promise<ListarProductosResult> {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const perPage = Math.max(1, Math.min(500, Math.floor(opts.perPage ?? 50)));

  const where = buildProductosWhere(opts);

  const orderBy = buildOrderBy(
    parseSortParams(
      { sort: opts.sort, dir: opts.dir },
      PRODUCTOS_SORT_ALLOWED,
      PRODUCTOS_SORT_DEFAULT,
    ),
    PRODUCTOS_SORT_FIELD_MAP,
  );

  const [rows, total, marcasRaw] = await Promise.all([
    db.producto.findMany({
      where,
      orderBy,
      take: perPage,
      skip: (page - 1) * perPage,
      select: PRODUCTO_ROW_SELECT,
    }),
    db.producto.count({ where }),
    // Opciones de marca = distinct sobre TODA la tabla (no de la página filtrada).
    db.producto.findMany({
      where: { marca: { not: null } },
      distinct: ["marca"],
      select: { marca: true },
      orderBy: { marca: "asc" },
    }),
  ]);

  const marcas = marcasRaw.map((m) => m.marca).filter((m): m is string => !!m && m.length > 0);

  return {
    rows: rows.map(mapProductoRow),
    total,
    marcas,
  };
}

// Export: mismas filas que la lista filtrada (q, marca, sort, dir) pero SIN
// paginación (todas las filas del set filtrado). No usar en la grilla.
export async function listarProductosParaExport(opts: {
  q?: string;
  marca?: string;
  sort?: string;
  dir?: SortDir;
}): Promise<ProductoRow[]> {
  const where = buildProductosWhere(opts);

  const orderBy = buildOrderBy(
    parseSortParams(
      { sort: opts.sort, dir: opts.dir },
      PRODUCTOS_SORT_ALLOWED,
      PRODUCTOS_SORT_DEFAULT,
    ),
    PRODUCTOS_SORT_FIELD_MAP,
  );

  const rows = await db.producto.findMany({
    where,
    orderBy,
    select: PRODUCTO_ROW_SELECT,
  });

  return rows.map(mapProductoRow);
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

export type ProductoActionResult = { ok: true; id: string } | { ok: false; error: string };

export async function crearProductoAction(raw: ProductoInput): Promise<ProductoActionResult> {
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
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
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

  const tieneReferencias = embarqueCount > 0 || compraCount > 0 || ventaCount > 0 || stockCount > 0;

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
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { ok: false, error: "El producto no existe." };
    }
    console.error("eliminarProductoAction failed", err);
    return { ok: false, error: "Error inesperado al eliminar el producto." };
  }
}
