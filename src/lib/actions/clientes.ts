"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { crearCuentaParaEntidad, rangoClienteByCanal } from "@/lib/services/cuenta-auto";
import { PREFIJO_CLIENTES } from "@/lib/services/prefijos-plan";
import { buildOrderBy, parseSortParams, type SortDir } from "@/lib/table-sort";
import { CondicionIva, CuentaTipo, Prisma, TipoCanal } from "@/generated/prisma/client";

export type ClienteRow = {
  id: string;
  nombre: string;
  cuit: string | null;
  tipo: string;
  tipoCanal: TipoCanal;
  condicionIva: CondicionIva;
  agenteRetencionIva: boolean;
  agenteRetencionGanancias: boolean;
  agenteIibb: boolean;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
  estado: string;
  cuentaContableId: number | null;
  cuentaContableCodigo: string | null;
  cuentaContableNombre: string | null;
  provinciaId: number | null;
  provinciaNombre: string | null;
  alicuotaPercepcionIIBB: string | null;
  exentoPercepcionIIBB: boolean;
};

export type CuentaContableOption = {
  id: number;
  codigo: string;
  nombre: string;
};

const CUENTAS_CLIENTES_PREFIX = PREFIJO_CLIENTES;

// Keys lógicas habilitadas para ordenar (allowlist) → mapean al campo real del
// modelo. NUNCA se pasa el nombre de columna crudo a Prisma: `buildOrderBy`
// solo lee de este mapa y `parseSortParams` rechaza keys fuera de `ALLOWED`.
const CLIENTES_SORT_FIELD_MAP = {
  nombre: "nombre",
  cuit: "cuit",
} as const;
const CLIENTES_SORT_ALLOWED = Object.keys(CLIENTES_SORT_FIELD_MAP);

export type ListarClientesOpts = {
  q?: string;
  estado?: string;
  page?: number;
  perPage?: number;
  sort?: string;
  dir?: SortDir;
};

export type ListarClientesResult = {
  rows: ClienteRow[];
  total: number;
};

export async function listarClientes(opts: ListarClientesOpts = {}): Promise<ListarClientesResult> {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const perPage = Math.max(1, Math.min(500, Math.floor(opts.perPage ?? 50)));

  const q = opts.q?.trim();
  const estado = opts.estado?.trim();

  const where: Prisma.ClienteWhereInput = {};
  if (q) {
    where.OR = [
      { nombre: { contains: q, mode: "insensitive" } },
      { cuit: { contains: q, mode: "insensitive" } },
    ];
  }
  if (estado === "activo") {
    where.estado = "activo";
  } else if (estado === "inactivo") {
    where.estado = "inactivo";
  }

  const orderBy = buildOrderBy(
    parseSortParams({ sort: opts.sort, dir: opts.dir }, CLIENTES_SORT_ALLOWED, {
      sort: "nombre",
      dir: "asc",
    }),
    CLIENTES_SORT_FIELD_MAP,
  );

  const [rows, total] = await Promise.all([
    db.cliente.findMany({
      where,
      orderBy,
      take: perPage,
      skip: (page - 1) * perPage,
      select: {
        id: true,
        nombre: true,
        cuit: true,
        tipo: true,
        tipoCanal: true,
        condicionIva: true,
        agenteRetencionIva: true,
        agenteRetencionGanancias: true,
        agenteIibb: true,
        direccion: true,
        telefono: true,
        email: true,
        estado: true,
        cuentaContableId: true,
        cuentaContable: { select: { codigo: true, nombre: true } },
        provinciaId: true,
        provincia: { select: { nombre: true } },
        alicuotaPercepcionIIBB: true,
        exentoPercepcionIIBB: true,
      },
    }),
    db.cliente.count({ where }),
  ]);

  return {
    rows: rows.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      cuit: c.cuit,
      tipo: c.tipo,
      tipoCanal: c.tipoCanal,
      condicionIva: c.condicionIva,
      agenteRetencionIva: c.agenteRetencionIva,
      agenteRetencionGanancias: c.agenteRetencionGanancias,
      agenteIibb: c.agenteIibb,
      direccion: c.direccion,
      telefono: c.telefono,
      email: c.email,
      estado: c.estado,
      cuentaContableId: c.cuentaContableId,
      cuentaContableCodigo: c.cuentaContable?.codigo ?? null,
      cuentaContableNombre: c.cuentaContable?.nombre ?? null,
      provinciaId: c.provinciaId,
      provinciaNombre: c.provincia?.nombre ?? null,
      alicuotaPercepcionIIBB: c.alicuotaPercepcionIIBB?.toString() ?? null,
      exentoPercepcionIIBB: c.exentoPercepcionIIBB,
    })),
    total,
  };
}

export async function listarCuentasContablesParaCliente(): Promise<CuentaContableOption[]> {
  const cuentas = await db.cuentaContable.findMany({
    where: {
      tipo: CuentaTipo.ANALITICA,
      activa: true,
      codigo: { startsWith: CUENTAS_CLIENTES_PREFIX },
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

const clienteBaseSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio."),
  cuit: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
  tipo: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : "minorista")),
  tipoCanal: z.nativeEnum(TipoCanal).default(TipoCanal.MINORISTA),
  agenteRetencionIva: z.boolean().optional().default(false),
  agenteRetencionGanancias: z.boolean().optional().default(false),
  agenteIibb: z.boolean().optional().default(false),
  condicionIva: z.nativeEnum(CondicionIva),
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
  // Localización fiscal AR (drill-down): provincia drives Percepción IIBB,
  // localidad e CP são enriquecimento. Optional para retrocompat.
  provinciaId: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  localidadId: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  codigoPostalId: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  // Override de alícuota Percepción IIBB. Se null, usa default da
  // jurisdicción. Aceita "" (vazio) que vira null.
  alicuotaPercepcionIIBB: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : null))
    .refine(
      (v) => v === null || /^\d+(\.\d{1,4})?$/.test(v),
      "Alícuota inválida (formato 0.0000-99.9999).",
    )
    .refine(
      (v) => v === null || (Number(v) >= 0 && Number(v) <= 100),
      "Alícuota fuera de rango [0, 100].",
    ),
  exentoPercepcionIIBB: z.boolean().optional().default(false),
  crearCuentaAuto: z.boolean().optional().default(false),
});

export type ClienteInput = z.input<typeof clienteBaseSchema>;

export type ClienteActionResult = { ok: true; id: string } | { ok: false; error: string };

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

function mapCrearClienteError(err: unknown): ClienteActionResult {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return { ok: false, error: "Ya existe un cliente con ese CUIT." };
  }
  if (err instanceof Error && err.message.startsWith("No hay códigos")) {
    return { ok: false, error: err.message };
  }
  console.error("crearClienteAction failed", err);
  return { ok: false, error: "Error inesperado al crear el cliente." };
}

export async function crearClienteAction(raw: ClienteInput): Promise<ClienteActionResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado." };

  const parsed = clienteBaseSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const cuentaCheck = await validarCuentaContable(parsed.data.cuentaContableId);
  if (!cuentaCheck.ok) return cuentaCheck;

  try {
    const created = await db.$transaction(async (tx) => {
      const cuentaContableId = await resolverCuentaContableCliente(tx, parsed.data);
      const { crearCuentaAuto: _ignore, ...rest } = parsed.data;
      void _ignore;
      return tx.cliente.create({
        data: { ...rest, cuentaContableId },
        select: { id: true },
      });
    });
    revalidatePath("/maestros/clientes");
    revalidatePath("/maestros");
    revalidatePath("/contabilidad/cuentas");
    return { ok: true, id: created.id };
  } catch (err) {
    return mapCrearClienteError(err);
  }
}

async function resolverCuentaContableCliente(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  data: z.infer<typeof clienteBaseSchema>,
): Promise<number | null> {
  if (data.cuentaContableId !== null) return data.cuentaContableId;
  if (!data.crearCuentaAuto) return null;
  const cuenta = await crearCuentaParaEntidad(tx, rangoClienteByCanal(data.tipoCanal), data.nombre);
  return cuenta.id;
}

export async function actualizarClienteAction(
  id: string,
  raw: ClienteInput,
): Promise<ClienteActionResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado." };

  if (!id) return { ok: false, error: "Id requerido." };

  const parsed = clienteBaseSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Datos inválidos." };
  }

  const cuentaCheck = await validarCuentaContable(parsed.data.cuentaContableId);
  if (!cuentaCheck.ok) return cuentaCheck;

  try {
    const { crearCuentaAuto: _ignore, ...rest } = parsed.data;
    void _ignore;
    const updated = await db.cliente.update({
      where: { id },
      data: rest,
      select: { id: true },
    });
    revalidatePath("/maestros/clientes");
    revalidatePath("/maestros");
    return { ok: true, id: updated.id };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") {
        return { ok: false, error: "Ya existe un cliente con ese CUIT." };
      }
      if (err.code === "P2025") {
        return { ok: false, error: "El cliente no existe." };
      }
    }
    console.error("actualizarClienteAction failed", err);
    return { ok: false, error: "Error inesperado al actualizar el cliente." };
  }
}

export async function eliminarClienteAction(
  id: string,
): Promise<{ ok: true; softDeleted: boolean } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado." };
  if (!id) return { ok: false, error: "Id requerido." };

  const ventasCount = await db.venta.count({ where: { clienteId: id } });

  try {
    if (ventasCount > 0) {
      await db.cliente.update({
        where: { id },
        data: { estado: "inactivo" },
        select: { id: true },
      });
      revalidatePath("/maestros/clientes");
      revalidatePath("/maestros");
      return { ok: true, softDeleted: true };
    }
    await db.cliente.delete({ where: { id } });
    revalidatePath("/maestros/clientes");
    revalidatePath("/maestros");
    return { ok: true, softDeleted: false };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { ok: false, error: "El cliente no existe." };
    }
    console.error("eliminarClienteAction failed", err);
    return { ok: false, error: "Error inesperado al eliminar el cliente." };
  }
}
