"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { money, sumMoney, toDecimal } from "@/lib/decimal";
import {
  AsientoError,
  anularAsiento,
  contabilizarAsiento,
  crearAsientoCompra,
} from "@/lib/services/asiento-automatico";
import {
  CompraEstado,
  CondicionPago,
  Moneda,
  Prisma,
} from "@/generated/prisma/client";

export type CompraRow = {
  id: string;
  numero: string;
  fecha: string;
  fechaVencimiento: string | null;
  proveedor: { id: string; nombre: string };
  moneda: Moneda;
  subtotal: string;
  iva: string;
  total: string;
  estado: CompraEstado;
  asientoId: string | null;
};

export type ProveedorParaCompra = {
  id: string;
  nombre: string;
  pais: string;
  diasPagoDefault: number | null;
  condicionPagoDefault: CondicionPago;
};

export type ProductoParaCompra = {
  id: string;
  codigo: string;
  nombre: string;
  costoPromedio: string;
};

export async function listarCompras(): Promise<CompraRow[]> {
  const rows = await db.compra.findMany({
    orderBy: { createdAt: "desc" },
    include: { proveedor: { select: { id: true, nombre: true } } },
  });
  return rows.map((c) => ({
    id: c.id,
    numero: c.numero,
    fecha: c.fecha.toISOString(),
    fechaVencimiento: c.fechaVencimiento?.toISOString() ?? null,
    proveedor: c.proveedor,
    moneda: c.moneda,
    subtotal: c.subtotal.toString(),
    iva: c.iva.toString(),
    total: c.total.toString(),
    estado: c.estado,
    asientoId: c.asientoId,
  }));
}

export async function listarProveedoresParaCompra(): Promise<
  ProveedorParaCompra[]
> {
  const rows = await db.proveedor.findMany({
    orderBy: { nombre: "asc" },
    select: {
      id: true,
      nombre: true,
      pais: true,
      diasPagoDefault: true,
      condicionPagoDefault: true,
    },
  });
  return rows.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    pais: p.pais,
    diasPagoDefault: p.diasPagoDefault,
    condicionPagoDefault: p.condicionPagoDefault,
  }));
}

export async function listarProductosParaCompra(): Promise<
  ProductoParaCompra[]
> {
  const rows = await db.producto.findMany({
    where: { activo: true },
    orderBy: { codigo: "asc" },
    select: { id: true, codigo: true, nombre: true, costoPromedio: true },
  });
  return rows.map((p) => ({
    id: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    costoPromedio: p.costoPromedio.toString(),
  }));
}

export type CompraDetalle = {
  id: string;
  numero: string;
  proveedorId: string;
  fecha: string;
  fechaVencimiento: string | null;
  condicionPago: CondicionPago;
  moneda: Moneda;
  tipoCambio: string;
  subtotal: string;
  iva: string;
  iibb: string;
  otros: string;
  total: string;
  estado: CompraEstado;
  asientoId: string | null;
  pedidoCompraId: number | null;
  notas: string | null;
  items: Array<{
    id: number;
    productoId: string;
    cantidad: number;
    precioUnitario: string;
    subtotal: string;
    iva: string;
    total: string;
  }>;
};

export async function obtenerCompraPorId(
  id: string,
): Promise<CompraDetalle | null> {
  const c = await db.compra.findUnique({
    where: { id },
    include: { items: { orderBy: { id: "asc" } } },
  });
  if (!c) return null;
  return {
    id: c.id,
    numero: c.numero,
    proveedorId: c.proveedorId,
    fecha: c.fecha.toISOString(),
    fechaVencimiento: c.fechaVencimiento?.toISOString() ?? null,
    condicionPago: c.condicionPago,
    moneda: c.moneda,
    tipoCambio: c.tipoCambio.toString(),
    subtotal: c.subtotal.toString(),
    iva: c.iva.toString(),
    iibb: c.iibb.toString(),
    otros: c.otros.toString(),
    total: c.total.toString(),
    estado: c.estado,
    asientoId: c.asientoId,
    pedidoCompraId: c.pedidoCompraId,
    notas: c.notas,
    items: c.items.map((it) => ({
      id: it.id,
      productoId: it.productoId,
      cantidad: it.cantidad,
      precioUnitario: it.precioUnitario.toString(),
      subtotal: it.subtotal.toString(),
      iva: it.iva.toString(),
      total: it.total.toString(),
    })),
  };
}

export async function generarNumeroCompra(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `C-${year}-`;
  const ultimo = await db.compra.findFirst({
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

const itemSchema = z.object({
  productoId: z.string().uuid("Seleccione un producto"),
  cantidad: z.number().int().positive("Cantidad > 0"),
  precioUnitario: z.string().regex(moneyRegex, "Precio inválido"),
  ivaPorcentaje: z.string().regex(/^\d+(\.\d{1,2})?$/, "IVA% inválido"),
});

const compraInputSchema = z
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
    iibb: z.string().regex(moneyRegex, "IIBB inválido").default("0"),
    otros: z.string().regex(moneyRegex, "Otros inválido").default("0"),
    notas: z
      .string()
      .max(500)
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
    items: z.array(itemSchema).min(1, "Al menos un ítem"),
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

export type CompraInput = z.input<typeof compraInputSchema>;

export type CompraActionResult =
  | { ok: true; id: string; numero: string }
  | { ok: false; error: string };

function calcItem(item: {
  cantidad: number;
  precioUnitario: string;
  ivaPorcentaje: string;
}) {
  const sub = toDecimal(item.precioUnitario).times(item.cantidad);
  const ivaPct = toDecimal(item.ivaPorcentaje).dividedBy(100);
  const iva = sub.times(ivaPct);
  return {
    subtotal: sub.toDecimalPlaces(2),
    iva: iva.toDecimalPlaces(2),
    total: sub.plus(iva).toDecimalPlaces(2),
  };
}

export async function guardarCompraAction(
  raw: CompraInput,
): Promise<CompraActionResult> {
  const parsed = compraInputSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: `${first.path.join(".")}: ${first.message}` };
  }
  const input = parsed.data;

  const itemsCalc = input.items.map((it) => ({
    ...it,
    ...calcItem(it),
  }));
  const subtotal = sumMoney(itemsCalc.map((i) => i.subtotal));
  const iva = sumMoney(itemsCalc.map((i) => i.iva));
  const total = sumMoney([subtotal, iva, input.iibb, input.otros]);

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
        subtotal: money(subtotal),
        iva: money(iva),
        iibb: money(input.iibb),
        otros: money(input.otros),
        total: money(total),
        notas: input.notas,
      };

      if (input.id) {
        const actual = await tx.compra.findUnique({
          where: { id: input.id },
          select: { estado: true, asientoId: true },
        });
        if (!actual) throw new Error("Compra no existe.");
        if (actual.asientoId) {
          throw new Error("Compra ya emitida; anule el asiento para editar.");
        }
        const c = await tx.compra.update({
          where: { id: input.id },
          data,
        });
        await tx.itemCompra.deleteMany({ where: { compraId: c.id } });
        id = c.id;
      } else {
        const c = await tx.compra.create({ data });
        id = c.id;
      }

      await tx.itemCompra.createMany({
        data: itemsCalc.map((it) => ({
          compraId: id,
          productoId: it.productoId,
          cantidad: it.cantidad,
          precioUnitario: money(it.precioUnitario),
          subtotal: money(it.subtotal),
          iva: money(it.iva),
          total: money(it.total),
        })),
      });

      return tx.compra.findUniqueOrThrow({
        where: { id },
        select: { id: true, numero: true },
      });
    });

    revalidatePath("/compras");
    revalidatePath(`/compras/${saved.id}`);
    return { ok: true, id: saved.id, numero: saved.numero };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return { ok: false, error: `El número "${input.numero}" ya existe.` };
    }
    if (err instanceof Error) return { ok: false, error: err.message };
    return { ok: false, error: "Error inesperado al guardar la compra." };
  }
}

export async function emitirCompraAction(
  compraId: string,
): Promise<{ ok: true; numeroAsiento: number } | { ok: false; error: string }> {
  try {
    const result = await db.$transaction(async (tx) => {
      const c = await tx.compra.findUnique({
        where: { id: compraId },
        select: { estado: true, asientoId: true, numero: true },
      });
      if (!c) throw new AsientoError("DOMINIO_INVALIDO", "Compra no existe.");
      if (c.asientoId) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          `Compra ${c.numero} ya tiene asiento.`,
        );
      }
      const asiento = await crearAsientoCompra(compraId, tx);
      const cont = await contabilizarAsiento(asiento.id, tx);
      await tx.compra.update({
        where: { id: compraId },
        data: { estado: CompraEstado.EMITIDA },
      });
      return cont.numero;
    });
    revalidatePath("/compras");
    revalidatePath(`/compras/${compraId}`);
    return { ok: true, numeroAsiento: result };
  } catch (err) {
    if (err instanceof AsientoError) return { ok: false, error: err.message };
    return { ok: false, error: "Error al emitir la compra." };
  }
}

export async function anularCompraAction(
  compraId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const c = await db.compra.findUnique({
      where: { id: compraId },
      select: { asientoId: true },
    });
    if (!c) return { ok: false, error: "Compra no existe." };
    if (!c.asientoId) {
      await db.compra.update({
        where: { id: compraId },
        data: { estado: CompraEstado.CANCELADA },
      });
    } else {
      await anularAsiento(c.asientoId);
    }
    revalidatePath("/compras");
    revalidatePath(`/compras/${compraId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof AsientoError) return { ok: false, error: err.message };
    return { ok: false, error: "Error al anular la compra." };
  }
}
