"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireSessionUser } from "@/lib/auth-guard";
import { puedeVerCosto } from "@/lib/permisos-masking";
import { db } from "@/lib/db";
import { registrarAuditoria } from "@/lib/services/auditoria";
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
  // `null` cuando la sesión no tiene `costos.ver` (PR-011): el costo se strip-ea
  // del payload (lista paginada y export). La grilla ya lo omite vía ProductoGridRow.
  costoPromedio: string | null;
  stockActual: number;
  stockMinimo: number;
  activo: boolean;
};

// Fila para la grilla del maestro: NO incluye `costoPromedio` (dato sensible que
// no se renderiza en la lista). El form de edición lo pide on-demand por producto.
export type ProductoGridRow = Omit<ProductoRow, "costoPromedio">;

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

function mapProductoRow(p: ProductoRowRaw, verCosto: boolean): ProductoRow {
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
    // Strip en el OUTPUT cuando falta `costos.ver` (PR-011); la query no cambia.
    costoPromedio: verCosto ? p.costoPromedio.toFixed(2) : null,
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

  const verCosto = await puedeVerCosto();
  return {
    rows: rows.map((p) => mapProductoRow(p, verCosto)),
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

  const verCosto = await puedeVerCosto();
  return rows.map((p) => mapProductoRow(p, verCosto));
}

// `select` para la grilla: mismo shape que `PRODUCTO_ROW_SELECT` SIN `costoPromedio`.
const PRODUCTO_GRID_SELECT = {
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
  stockActual: true,
  stockMinimo: true,
  activo: true,
} satisfies Prisma.ProductoSelect;

type ProductoGridRowRaw = Prisma.ProductoGetPayload<{ select: typeof PRODUCTO_GRID_SELECT }>;

function mapProductoGridRow(p: ProductoGridRowRaw): ProductoGridRow {
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
    stockActual: p.stockActual,
    stockMinimo: p.stockMinimo,
    activo: p.activo,
  };
}

// Grilla del maestro: TODAS las filas (sin paginación server-side) ordenadas por
// código. El EnterpriseDataGrid resuelve búsqueda/filtro/orden/paginación en el
// cliente sobre este set completo. El `costoPromedio` no viaja en el payload.
export async function listarProductosGrid(): Promise<ProductoGridRow[]> {
  const rows = await db.producto.findMany({
    orderBy: { codigo: "asc" },
    select: PRODUCTO_GRID_SELECT,
  });
  return rows.map(mapProductoGridRow);
}

// Costo promedio de UN producto, pedido on-demand al abrir el form de edición
// (así el dato sensible no viaja para las ~miles de filas de la lista).
export async function obtenerProductoCosto(id: string): Promise<string | null> {
  // BE guard (PR-011): sin `costos.ver` no se devuelve el costo. La firma ya
  // permite null y el form lo renderiza como "—".
  if (!(await puedeVerCosto())) return null;
  const p = await db.producto.findUnique({
    where: { id },
    select: { costoPromedio: true },
  });
  return p ? p.costoPromedio.toFixed(2) : null;
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

// Campos del producto que se versionan en la auditoría (los controlados por el
// form). diePorcentaje/precioVenta son Decimal → se serializan a number.
// NO exportar (archivo "use server").
const SNAPSHOT_PRODUCTO = {
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
  stockMinimo: true,
  activo: true,
} as const;

type ProductoSnapshot = Prisma.ProductoGetPayload<{ select: typeof SNAPSHOT_PRODUCTO }>;

// Convierte el snapshot a JSON-safe: los Decimal no entran directo en columna Json.
function serializarProducto(row: ProductoSnapshot): Record<string, unknown> {
  return {
    ...row,
    diePorcentaje: Number(row.diePorcentaje),
    precioVenta: Number(row.precioVenta),
  };
}

export async function crearProductoAction(raw: ProductoInput): Promise<ProductoActionResult> {
  const usuarioId = await requireSessionUser();

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
    const created = await db.$transaction(async (tx) => {
      const { id, ...snapshot } = await tx.producto.create({
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
        select: { id: true, ...SNAPSHOT_PRODUCTO },
      });
      await registrarAuditoria(tx, {
        tabla: "Producto",
        registroId: id,
        accion: "CREATE",
        usuarioId,
        datosNuevos: serializarProducto(snapshot),
      });
      return { id };
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
  const usuarioId = await requireSessionUser();
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
    const updated = await db.$transaction(async (tx) => {
      const antes = await tx.producto.findUnique({ where: { id }, select: SNAPSHOT_PRODUCTO });
      if (!antes)
        throw new Prisma.PrismaClientKnownRequestError("No existe", {
          code: "P2025",
          clientVersion: "",
        });
      const { id: updatedId, ...despues } = await tx.producto.update({
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
        select: { id: true, ...SNAPSHOT_PRODUCTO },
      });
      await registrarAuditoria(tx, {
        tabla: "Producto",
        registroId: updatedId,
        accion: "UPDATE",
        usuarioId,
        datosAnteriores: serializarProducto(antes),
        datosNuevos: serializarProducto(despues),
      });
      return { id: updatedId };
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
  const usuarioId = await requireSessionUser();
  if (!id) return { ok: false, error: "Id requerido." };

  try {
    const { softDeleted } = await db.$transaction(async (tx) => {
      const antes = await tx.producto.findUnique({ where: { id }, select: SNAPSHOT_PRODUCTO });
      if (!antes)
        throw new Prisma.PrismaClientKnownRequestError("No existe", {
          code: "P2025",
          clientVersion: "",
        });

      const [embarqueCount, compraCount, ventaCount, stockCount] = await Promise.all([
        tx.itemEmbarque.count({ where: { productoId: id } }),
        tx.itemCompra.count({ where: { productoId: id } }),
        tx.itemVenta.count({ where: { productoId: id } }),
        tx.movimientoStock.count({ where: { productoId: id } }),
      ]);

      if (embarqueCount > 0 || compraCount > 0 || ventaCount > 0 || stockCount > 0) {
        await tx.producto.update({ where: { id }, data: { activo: false }, select: { id: true } });
        await registrarAuditoria(tx, {
          tabla: "Producto",
          registroId: id,
          accion: "UPDATE",
          usuarioId,
          datosAnteriores: serializarProducto(antes),
          datosNuevos: serializarProducto({ ...antes, activo: false }),
        });
        return { softDeleted: true };
      }

      await registrarAuditoria(tx, {
        tabla: "Producto",
        registroId: id,
        accion: "DELETE",
        usuarioId,
        datosAnteriores: serializarProducto(antes),
      });
      await tx.producto.delete({ where: { id } });
      return { softDeleted: false };
    });
    revalidatePath("/maestros/productos");
    revalidatePath("/maestros");
    return { ok: true, softDeleted };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { ok: false, error: "El producto no existe." };
    }
    console.error("eliminarProductoAction failed", err);
    return { ok: false, error: "Error inesperado al eliminar el producto." };
  }
}
