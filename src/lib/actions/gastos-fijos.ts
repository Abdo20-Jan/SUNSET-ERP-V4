"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  AsientoError,
  anularAsiento,
} from "@/lib/services/asiento-automatico";
import { registrarGastoFijoPeriodo } from "@/lib/services/gasto-fijo";
import {
  CuentaCategoria,
  CuentaTipo,
  Moneda,
} from "@/generated/prisma/client";

export type GastoFijoRow = {
  id: number;
  descripcion: string;
  proveedorId: string;
  proveedorNombre: string;
  cuentaGastoContableId: number | null;
  cuentaGastoCodigo: string | null;
  cuentaGastoNombre: string | null;
  moneda: Moneda;
  montoNeto: string;
  ivaPorcentaje: string;
  iibbPorcentaje: string;
  diaVencimiento: number | null;
  activo: boolean;
  notas: string | null;
  registrosCount: number;
  ultimoRegistro: { year: number; month: number; total: string } | null;
};

export type GastoFijoRegistroRow = {
  id: number;
  periodoYear: number;
  periodoMonth: number;
  fecha: string;
  total: string;
  asientoId: string | null;
  asientoNumero: number | null;
  asientoEstado: "BORRADOR" | "CONTABILIZADO" | "ANULADO" | null;
};

export async function listarGastosFijos(): Promise<GastoFijoRow[]> {
  const rows = await db.gastoFijo.findMany({
    orderBy: [{ activo: "desc" }, { descripcion: "asc" }],
    include: {
      proveedor: { select: { nombre: true } },
      cuentaGastoContable: { select: { codigo: true, nombre: true } },
      registros: {
        orderBy: [{ periodoYear: "desc" }, { periodoMonth: "desc" }],
        take: 1,
        select: { periodoYear: true, periodoMonth: true, total: true },
      },
      _count: { select: { registros: true } },
    },
  });

  return rows.map((g) => ({
    id: g.id,
    descripcion: g.descripcion,
    proveedorId: g.proveedorId,
    proveedorNombre: g.proveedor.nombre,
    cuentaGastoContableId: g.cuentaGastoContableId,
    cuentaGastoCodigo: g.cuentaGastoContable?.codigo ?? null,
    cuentaGastoNombre: g.cuentaGastoContable?.nombre ?? null,
    moneda: g.moneda,
    montoNeto: g.montoNeto.toFixed(2),
    ivaPorcentaje: g.ivaPorcentaje.toFixed(2),
    iibbPorcentaje: g.iibbPorcentaje.toFixed(2),
    diaVencimiento: g.diaVencimiento,
    activo: g.activo,
    notas: g.notas,
    registrosCount: g._count.registros,
    ultimoRegistro: g.registros[0]
      ? {
          year: g.registros[0].periodoYear,
          month: g.registros[0].periodoMonth,
          total: g.registros[0].total.toFixed(2),
        }
      : null,
  }));
}

export type ProveedorOptionParaGastoFijo = {
  id: string;
  nombre: string;
  cuentaGastoContableId: number | null;
};

export async function listarProveedoresParaGastoFijo(): Promise<
  ProveedorOptionParaGastoFijo[]
> {
  const rows = await db.proveedor.findMany({
    where: { estado: "activo" },
    orderBy: { nombre: "asc" },
    select: {
      id: true,
      nombre: true,
      cuentaGastoContableId: true,
    },
  });
  return rows;
}

export type CuentaGastoOption = {
  id: number;
  codigo: string;
  nombre: string;
};

export async function listarCuentasParaGastoFijo(): Promise<CuentaGastoOption[]> {
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

const PORCENTAJE_RE = /^\d{1,3}(\.\d{1,2})?$/;
const MONEY_RE = /^\d+(\.\d{1,2})?$/;

const inputSchema = z.object({
  descripcion: z.string().trim().min(1, "Descripción obligatoria.").max(255),
  proveedorId: z.string().uuid("Proveedor obligatorio."),
  cuentaGastoContableId: z.number().int().positive().nullable().optional()
    .transform((v) => v ?? null),
  moneda: z.nativeEnum(Moneda).default(Moneda.ARS),
  montoNeto: z.string().regex(MONEY_RE, "Monto inválido (máx. 2 decimales)."),
  ivaPorcentaje: z.string().regex(PORCENTAJE_RE, "% IVA inválido.").default("21"),
  iibbPorcentaje: z.string().regex(PORCENTAJE_RE, "% IIBB inválido.").default("0"),
  diaVencimiento: z.number().int().min(1).max(28).nullable().optional()
    .transform((v) => v ?? null),
  activo: z.boolean().default(true),
  notas: z.string().trim().max(500).optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export type GastoFijoInput = z.input<typeof inputSchema>;

export type GastoFijoActionResult =
  | { ok: true; id: number }
  | { ok: false; error: string };

export async function crearGastoFijoAction(
  raw: GastoFijoInput,
): Promise<GastoFijoActionResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado." };

  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const created = await db.gastoFijo.create({
    data: parsed.data,
    select: { id: true },
  });

  revalidatePath("/gastos-fijos");
  return { ok: true, id: created.id };
}

export async function actualizarGastoFijoAction(
  id: number,
  raw: GastoFijoInput,
): Promise<GastoFijoActionResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado." };

  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const updated = await db.gastoFijo.update({
    where: { id },
    data: parsed.data,
    select: { id: true },
  });

  revalidatePath("/gastos-fijos");
  return { ok: true, id: updated.id };
}

export async function eliminarGastoFijoAction(
  id: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado." };

  const conRegistros = await db.gastoFijoRegistro.count({
    where: { gastoFijoId: id },
  });
  if (conRegistros > 0) {
    return {
      ok: false,
      error: `No se puede eliminar: hay ${conRegistros} registros mensuales contabilizados. Desactivá el gasto en lugar de eliminarlo.`,
    };
  }

  await db.gastoFijo.delete({ where: { id } });
  revalidatePath("/gastos-fijos");
  return { ok: true };
}

const registrarSchema = z.object({
  gastoFijoId: z.number().int().positive(),
  year: z.number().int().min(2020).max(2030),
  month: z.number().int().min(1).max(12),
  fecha: z.coerce.date(),
  tipoCambio: z.string().regex(/^\d+(\.\d{1,6})?$/, "TC inválido."),
});

export type RegistrarGastoFijoInput = z.input<typeof registrarSchema>;

export async function registrarGastoFijoAction(
  raw: RegistrarGastoFijoInput,
): Promise<{ ok: true; asientoId: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado." };

  const parsed = registrarSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  try {
    const result = await registrarGastoFijoPeriodo(parsed.data);
    revalidatePath("/gastos-fijos");
    revalidatePath("/contabilidad/asientos");
    revalidatePath("/tesoreria/cuentas-a-pagar");
    return { ok: true, asientoId: result.asiento.id };
  } catch (err) {
    if (err instanceof AsientoError) return { ok: false, error: err.message };
    console.error("registrarGastoFijoAction failed", err);
    return { ok: false, error: "Error inesperado al registrar el gasto." };
  }
}

export async function listarRegistrosGastoFijo(
  gastoFijoId: number,
): Promise<GastoFijoRegistroRow[]> {
  const rows = await db.gastoFijoRegistro.findMany({
    where: { gastoFijoId },
    orderBy: [{ periodoYear: "desc" }, { periodoMonth: "desc" }],
    include: {
      asiento: { select: { id: true, numero: true, estado: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    periodoYear: r.periodoYear,
    periodoMonth: r.periodoMonth,
    fecha: r.fecha.toISOString(),
    total: r.total.toFixed(2),
    asientoId: r.asiento?.id ?? null,
    asientoNumero: r.asiento?.numero ?? null,
    asientoEstado: r.asiento?.estado ?? null,
  }));
}

export async function anularRegistroGastoFijoAction(
  registroId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado." };

  try {
    await db.$transaction(async (tx) => {
      const registro = await tx.gastoFijoRegistro.findUnique({
        where: { id: registroId },
        select: { id: true, gastoFijoId: true, asientoId: true },
      });
      if (!registro) throw new Error("Registro no encontrado.");
      if (registro.asientoId) {
        await anularAsiento(registro.asientoId, tx);
      }
      await tx.gastoFijoRegistro.delete({ where: { id: registroId } });
    });
    revalidatePath("/gastos-fijos");
    return { ok: true };
  } catch (err) {
    if (err instanceof AsientoError) return { ok: false, error: err.message };
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return { ok: false, error: msg };
  }
}
