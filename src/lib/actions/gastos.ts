"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { money, sumMoney, toDecimal } from "@/lib/decimal";
import {
  AsientoError,
  anularAsiento,
  contabilizarAsiento,
  crearAsientoGasto,
} from "@/lib/services/asiento-automatico";
import {
  CondicionPago,
  GastoEstado,
  Moneda,
  Prisma,
} from "@/generated/prisma/client";

export type GastoRow = {
  id: string;
  numero: string;
  fecha: string;
  fechaVencimiento: string | null;
  proveedor: { id: string; nombre: string };
  facturaNumero: string | null;
  moneda: Moneda;
  subtotal: string;
  iva: string;
  iibb: string;
  total: string;
  estado: GastoEstado;
  asientoId: string | null;
};

export async function listarGastos(filters?: {
  desde?: string;
  hasta?: string;
}): Promise<GastoRow[]> {
  const where: Prisma.GastoWhereInput = {};
  if (filters?.desde || filters?.hasta) {
    where.fecha = {};
    if (filters.desde) where.fecha.gte = new Date(filters.desde);
    if (filters.hasta) {
      const h = new Date(filters.hasta);
      h.setHours(23, 59, 59, 999);
      where.fecha.lte = h;
    }
  }
  const rows = await db.gasto.findMany({
    where,
    orderBy: [{ fecha: "desc" }, { createdAt: "desc" }],
    include: { proveedor: { select: { id: true, nombre: true } } },
  });
  return rows.map((g) => ({
    id: g.id,
    numero: g.numero,
    fecha: g.fecha.toISOString(),
    fechaVencimiento: g.fechaVencimiento?.toISOString() ?? null,
    proveedor: g.proveedor,
    facturaNumero: g.facturaNumero,
    moneda: g.moneda,
    subtotal: g.subtotal.toString(),
    iva: g.iva.toString(),
    iibb: g.iibb.toString(),
    total: g.total.toString(),
    estado: g.estado,
    asientoId: g.asientoId,
  }));
}

export type ProveedorParaGasto = {
  id: string;
  nombre: string;
  diasPagoDefault: number | null;
  condicionPagoDefault: CondicionPago;
  cuentaGastoContableId: number | null;
};

export async function listarProveedoresParaGasto(): Promise<
  ProveedorParaGasto[]
> {
  const rows = await db.proveedor.findMany({
    where: { estado: "activo" },
    orderBy: { nombre: "asc" },
    select: {
      id: true,
      nombre: true,
      diasPagoDefault: true,
      condicionPagoDefault: true,
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

export async function listarCuentasGasto(): Promise<CuentaGastoOption[]> {
  const rows = await db.cuentaContable.findMany({
    where: {
      activa: true,
      tipo: "ANALITICA",
      categoria: { in: ["EGRESO", "ACTIVO"] },
    },
    orderBy: { codigo: "asc" },
    select: { id: true, codigo: true, nombre: true },
  });
  return rows;
}

export type GastoDetalle = {
  id: string;
  numero: string;
  proveedorId: string;
  fecha: string;
  fechaVencimiento: string | null;
  condicionPago: CondicionPago;
  moneda: Moneda;
  tipoCambio: string;
  facturaNumero: string | null;
  subtotal: string;
  iva: string;
  iibb: string;
  otros: string;
  total: string;
  estado: GastoEstado;
  asientoId: string | null;
  notas: string | null;
  lineas: Array<{
    id: number;
    cuentaContableGastoId: number;
    descripcion: string;
    subtotal: string;
  }>;
};

export async function obtenerGastoPorId(
  id: string,
): Promise<GastoDetalle | null> {
  const g = await db.gasto.findUnique({
    where: { id },
    include: { lineas: { orderBy: { id: "asc" } } },
  });
  if (!g) return null;
  return {
    id: g.id,
    numero: g.numero,
    proveedorId: g.proveedorId,
    fecha: g.fecha.toISOString(),
    fechaVencimiento: g.fechaVencimiento?.toISOString() ?? null,
    condicionPago: g.condicionPago,
    moneda: g.moneda,
    tipoCambio: g.tipoCambio.toString(),
    facturaNumero: g.facturaNumero,
    subtotal: g.subtotal.toString(),
    iva: g.iva.toString(),
    iibb: g.iibb.toString(),
    otros: g.otros.toString(),
    total: g.total.toString(),
    estado: g.estado,
    asientoId: g.asientoId,
    notas: g.notas,
    lineas: g.lineas.map((l) => ({
      id: l.id,
      cuentaContableGastoId: l.cuentaContableGastoId,
      descripcion: l.descripcion,
      subtotal: l.subtotal.toString(),
    })),
  };
}

export async function generarNumeroGasto(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `G-${year}-`;
  const ultimo = await db.gasto.findFirst({
    where: { numero: { startsWith: prefix } },
    orderBy: { numero: "desc" },
    select: { numero: true },
  });
  let next = 1;
  if (ultimo) {
    const parsed = parseInt(ultimo.numero.slice(prefix.length), 10);
    if (!Number.isNaN(parsed)) next = parsed + 1;
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
}

const moneyRegex = /^\d+(\.\d{1,2})?$/;
const rateRegex = /^\d+(\.\d{1,6})?$/;

const lineaSchema = z.object({
  cuentaContableGastoId: z.number().int().positive("Seleccione cuenta de gasto"),
  descripcion: z.string().min(1, "Descripción requerida").max(200),
  subtotal: z.string().regex(moneyRegex, "Subtotal inválido"),
});

const gastoInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    numero: z.string().min(1).max(32),
    proveedorId: z.string().uuid("Seleccione proveedor"),
    fecha: z.string().min(1, "Fecha requerida"),
    fechaVencimiento: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v : null)),
    condicionPago: z.nativeEnum(CondicionPago),
    moneda: z.nativeEnum(Moneda),
    tipoCambio: z.string().regex(rateRegex, "TC inválido"),
    facturaNumero: z
      .string()
      .max(64)
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
    iva: z.string().regex(moneyRegex, "IVA inválido").default("0"),
    iibb: z.string().regex(moneyRegex, "IIBB inválido").default("0"),
    otros: z.string().regex(moneyRegex, "Otros inválido").default("0"),
    notas: z
      .string()
      .max(500)
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
    lineas: z.array(lineaSchema).min(1, "Al menos una línea"),
  })
  .superRefine((data, ctx) => {
    if (data.moneda === Moneda.ARS && data.tipoCambio !== "1") {
      ctx.addIssue({
        code: "custom",
        path: ["tipoCambio"],
        message: "Para ARS, TC=1",
      });
    }
    if (data.fechaVencimiento) {
      if (new Date(data.fechaVencimiento) < new Date(data.fecha)) {
        ctx.addIssue({
          code: "custom",
          path: ["fechaVencimiento"],
          message: "Fecha de vencimiento no puede ser anterior a la factura",
        });
      }
    }
  });

export type GastoInput = z.input<typeof gastoInputSchema>;

export type GastoActionResult =
  | { ok: true; id: string; numero: string }
  | { ok: false; error: string };

export async function guardarGastoAction(
  raw: GastoInput,
): Promise<GastoActionResult> {
  const parsed = gastoInputSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: `${first.path.join(".")}: ${first.message}` };
  }
  const input = parsed.data;

  const subtotal = sumMoney(input.lineas.map((l) => l.subtotal));
  const total = sumMoney([subtotal, input.iva, input.iibb, input.otros]);

  try {
    const saved = await db.$transaction(async (tx) => {
      let id: string;
      const data = {
        numero: input.numero,
        proveedorId: input.proveedorId,
        fecha: new Date(input.fecha),
        fechaVencimiento: input.fechaVencimiento
          ? new Date(input.fechaVencimiento)
          : null,
        condicionPago: input.condicionPago,
        moneda: input.moneda,
        tipoCambio: new Prisma.Decimal(input.tipoCambio),
        facturaNumero: input.facturaNumero,
        subtotal: money(subtotal),
        iva: money(input.iva),
        iibb: money(input.iibb),
        otros: money(input.otros),
        total: money(total),
        notas: input.notas,
      };

      if (input.id) {
        const actual = await tx.gasto.findUnique({
          where: { id: input.id },
          select: { asientoId: true, estado: true },
        });
        if (!actual) throw new Error("Gasto no existe.");
        if (actual.asientoId || actual.estado !== "BORRADOR") {
          throw new Error("Gasto ya contabilizado; anule para editar.");
        }
        const g = await tx.gasto.update({
          where: { id: input.id },
          data,
        });
        await tx.lineaGasto.deleteMany({ where: { gastoId: g.id } });
        id = g.id;
      } else {
        const g = await tx.gasto.create({ data });
        id = g.id;
      }

      await tx.lineaGasto.createMany({
        data: input.lineas.map((l) => ({
          gastoId: id,
          cuentaContableGastoId: l.cuentaContableGastoId,
          descripcion: l.descripcion.trim(),
          subtotal: money(l.subtotal),
        })),
      });

      return tx.gasto.findUniqueOrThrow({
        where: { id },
        select: { id: true, numero: true },
      });
    });

    revalidatePath("/gastos");
    revalidatePath(`/gastos/${saved.id}`);
    return { ok: true, id: saved.id, numero: saved.numero };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return { ok: false, error: `El número "${input.numero}" ya existe.` };
    }
    if (err instanceof Error) return { ok: false, error: err.message };
    return { ok: false, error: "Error inesperado al guardar el gasto." };
  }
}

export async function contabilizarGastoAction(
  gastoId: string,
): Promise<{ ok: true; numeroAsiento: number } | { ok: false; error: string }> {
  try {
    const result = await db.$transaction(async (tx) => {
      const g = await tx.gasto.findUnique({
        where: { id: gastoId },
        select: { estado: true, asientoId: true, numero: true },
      });
      if (!g) throw new AsientoError("DOMINIO_INVALIDO", "Gasto no existe.");
      if (g.asientoId) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          `Gasto ${g.numero} ya tiene asiento.`,
        );
      }
      if (g.estado !== "BORRADOR") {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          `Sólo gastos en BORRADOR pueden contabilizarse (${g.estado}).`,
        );
      }
      const asiento = await crearAsientoGasto(gastoId, tx);
      const cont = await contabilizarAsiento(asiento.id, tx);
      return cont.numero;
    });
    revalidatePath("/gastos");
    revalidatePath(`/gastos/${gastoId}`);
    revalidatePath("/tesoreria/cuentas-a-pagar");
    return { ok: true, numeroAsiento: result };
  } catch (err) {
    if (err instanceof AsientoError) return { ok: false, error: err.message };
    return { ok: false, error: "Error al contabilizar el gasto." };
  }
}

export async function anularGastoAction(
  gastoId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const g = await db.gasto.findUnique({
      where: { id: gastoId },
      select: { asientoId: true, estado: true },
    });
    if (!g) return { ok: false, error: "Gasto no existe." };
    if (g.asientoId) {
      await anularAsiento(g.asientoId);
    } else if (g.estado === "BORRADOR") {
      await db.gasto.update({
        where: { id: gastoId },
        data: { estado: GastoEstado.ANULADO },
      });
    }
    revalidatePath("/gastos");
    revalidatePath(`/gastos/${gastoId}`);
    revalidatePath("/tesoreria/cuentas-a-pagar");
    return { ok: true };
  } catch (err) {
    if (err instanceof AsientoError) return { ok: false, error: err.message };
    return { ok: false, error: "Error al anular el gasto." };
  }
}

export async function eliminarGastoAction(
  gastoId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const g = await db.gasto.findUnique({
      where: { id: gastoId },
      select: { asientoId: true, estado: true },
    });
    if (!g) return { ok: false, error: "Gasto no existe." };
    if (g.asientoId || g.estado === "CONTABILIZADO") {
      return {
        ok: false,
        error: "No se puede eliminar un gasto contabilizado. Anular primero.",
      };
    }
    await db.gasto.delete({ where: { id: gastoId } });
    revalidatePath("/gastos");
    return { ok: true };
  } catch (err) {
    if (err instanceof Error) return { ok: false, error: err.message };
    return { ok: false, error: "Error al eliminar el gasto." };
  }
}
