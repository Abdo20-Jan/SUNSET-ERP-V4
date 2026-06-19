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
import { PREFIJO_PROVEEDORES_LOCAL } from "@/lib/services/prefijos-plan";
import { buildOrderBy, parseSortParams, type SortDir } from "@/lib/table-sort";
import {
  CondicionGanancias,
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
  sujetoRetencionGanancias: boolean;
  condicionGanancias: CondicionGanancias;
  alicuotaRetencionGananciasOverride: string | null;
  certificadoExclusionGanancias: string | null;
  vigenciaCertExclusionGanancias: string | null;
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

const CUENTAS_PROVEEDORES_PREFIX = PREFIJO_PROVEEDORES_LOCAL;

// Keys lógicas habilitadas para ordenar (allowlist) → mapean al campo real del
// modelo. NUNCA se pasa el nombre de columna crudo a Prisma: `buildOrderBy`
// solo lee de este mapa y `parseSortParams` rechaza keys fuera de `ALLOWED`.
const PROVEEDORES_SORT_FIELD_MAP = {
  nombre: "nombre",
  cuit: "cuit",
  pais: "pais",
} as const;
const PROVEEDORES_SORT_ALLOWED = Object.keys(PROVEEDORES_SORT_FIELD_MAP);
const PROVEEDORES_SORT_DEFAULT = { sort: "nombre", dir: "asc" } as const;

// `select` compartido entre la lista paginada y el export (mismo shape de fila).
const PROVEEDOR_ROW_SELECT = {
  id: true,
  nombre: true,
  cuit: true,
  tipo: true,
  tipoProveedor: true,
  conceptoRG830: true,
  sujetoRetencionGanancias: true,
  condicionGanancias: true,
  alicuotaRetencionGananciasOverride: true,
  certificadoExclusionGanancias: true,
  vigenciaCertExclusionGanancias: true,
  pais: true,
  direccion: true,
  telefono: true,
  email: true,
  estado: true,
  cuentaContableId: true,
  cuentaContable: { select: { codigo: true, nombre: true } },
  cuentaGastoContableId: true,
  cuentaGastoContable: { select: { codigo: true, nombre: true } },
} satisfies Prisma.ProveedorSelect;

type ProveedorRowRaw = Prisma.ProveedorGetPayload<{ select: typeof PROVEEDOR_ROW_SELECT }>;

function mapProveedorRow(p: ProveedorRowRaw): ProveedorRow {
  return {
    id: p.id,
    nombre: p.nombre,
    cuit: p.cuit,
    tipo: p.tipo,
    tipoProveedor: p.tipoProveedor,
    conceptoRG830: p.conceptoRG830,
    sujetoRetencionGanancias: p.sujetoRetencionGanancias,
    condicionGanancias: p.condicionGanancias,
    alicuotaRetencionGananciasOverride: p.alicuotaRetencionGananciasOverride?.toString() ?? null,
    certificadoExclusionGanancias: p.certificadoExclusionGanancias,
    vigenciaCertExclusionGanancias: p.vigenciaCertExclusionGanancias
      ? p.vigenciaCertExclusionGanancias.toISOString().slice(0, 10)
      : null,
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
  };
}

// Construye el `where` a partir de {q, pais}. Reutilizado por `listarProveedores`
// (paginado) y `listarProveedoresParaExport` (todas las filas del set filtrado).
function buildProveedoresWhere(opts: { q?: string; pais?: string }): Prisma.ProveedorWhereInput {
  const q = opts.q?.trim();
  const pais = opts.pais?.trim();

  const where: Prisma.ProveedorWhereInput = {};
  if (q) {
    where.OR = [
      { nombre: { contains: q, mode: "insensitive" } },
      { cuit: { contains: q, mode: "insensitive" } },
    ];
  }
  if (pais && pais !== "todos") {
    where.pais = pais;
  }
  return where;
}

export type ListarProveedoresOpts = {
  q?: string;
  pais?: string;
  page?: number;
  perPage?: number;
  sort?: string;
  dir?: SortDir;
};

export type ListarProveedoresResult = {
  rows: ProveedorRow[];
  total: number;
  paises: string[];
};

export async function listarProveedores(
  opts: ListarProveedoresOpts = {},
): Promise<ListarProveedoresResult> {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const perPage = Math.max(1, Math.min(500, Math.floor(opts.perPage ?? 50)));

  const where = buildProveedoresWhere(opts);

  const orderBy = buildOrderBy(
    parseSortParams(
      { sort: opts.sort, dir: opts.dir },
      PROVEEDORES_SORT_ALLOWED,
      PROVEEDORES_SORT_DEFAULT,
    ),
    PROVEEDORES_SORT_FIELD_MAP,
  );

  const [rows, total, paisesRaw] = await Promise.all([
    db.proveedor.findMany({
      where,
      orderBy,
      take: perPage,
      skip: (page - 1) * perPage,
      select: PROVEEDOR_ROW_SELECT,
    }),
    db.proveedor.count({ where }),
    // Opciones de país = distinct sobre TODA la tabla (no de la página filtrada).
    db.proveedor.findMany({
      distinct: ["pais"],
      select: { pais: true },
      orderBy: { pais: "asc" },
    }),
  ]);

  const paises = paisesRaw.map((p) => p.pais).filter((p): p is string => !!p && p.length > 0);

  return {
    rows: rows.map(mapProveedorRow),
    total,
    paises,
  };
}

// Export: mismas filas que la lista filtrada (q, pais, sort, dir) pero SIN
// paginación (todas las filas del set filtrado). No usar en la grilla.
export async function listarProveedoresParaExport(opts: {
  q?: string;
  pais?: string;
  sort?: string;
  dir?: SortDir;
}): Promise<ProveedorRow[]> {
  const where = buildProveedoresWhere(opts);

  const orderBy = buildOrderBy(
    parseSortParams(
      { sort: opts.sort, dir: opts.dir },
      PROVEEDORES_SORT_ALLOWED,
      PROVEEDORES_SORT_DEFAULT,
    ),
    PROVEEDORES_SORT_FIELD_MAP,
  );

  const rows = await db.proveedor.findMany({
    where,
    orderBy,
    select: PROVEEDOR_ROW_SELECT,
  });

  return rows.map(mapProveedorRow);
}

export async function listarCuentasContablesParaProveedor(): Promise<CuentaContableOption[]> {
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
export async function listarCuentasContablesParaGastoProveedor(): Promise<CuentaContableOption[]> {
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

const proveedorBaseSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio."),
  cuit: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
  tipo: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : "otro")),
  tipoProveedor: z.nativeEnum(TipoProveedor).default(TipoProveedor.MERCADERIA_LOCAL),
  conceptoRG830: z.nativeEnum(ConceptoRG830).optional().nullable(),
  // --- Retención Ganancias (RG 830) ---
  sujetoRetencionGanancias: z.boolean().optional().default(false),
  condicionGanancias: z.nativeEnum(CondicionGanancias).default(CondicionGanancias.INSCRIPTO),
  alicuotaRetencionGananciasOverride: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : null))
    .refine(
      (v) => v === null || /^\d+(\.\d{1,4})?$/.test(v),
      "Alícuota inválida (máx. 4 decimales).",
    ),
  certificadoExclusionGanancias: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
  vigenciaCertExclusionGanancias: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v && v.trim().length > 0 ? new Date(v) : null)),
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
    .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Email inválido."),
  estado: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : "activo"))
    .refine((v) => v === "activo" || v === "inactivo", "Estado debe ser 'activo' o 'inactivo'."),
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

export type ProveedorActionResult = { ok: true; id: string } | { ok: false; error: string };

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

export async function crearProveedorAction(raw: ProveedorInput): Promise<ProveedorActionResult> {
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
          const cuentaGasto = await crearCuentaParaEntidad(tx, rangoGasto, parsed.data.nombre);
          cuentaGastoContableId = cuentaGasto.id;
        }
      }
      const { crearCuentaAuto: _ignore, crearCuentaGastoAuto: _ignore2, ...rest } = parsed.data;
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
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
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
          const cuentaGasto = await crearCuentaParaEntidad(tx, rangoGasto, parsed.data.nombre);
          cuentaGastoContableId = cuentaGasto.id;
        }
      }
      const { crearCuentaAuto: _ignore, crearCuentaGastoAuto: _ignore2, ...rest } = parsed.data;
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
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { ok: false, error: "El proveedor no existe." };
    }
    console.error("eliminarProveedorAction failed", err);
    return { ok: false, error: "Error inesperado al eliminar el proveedor." };
  }
}
