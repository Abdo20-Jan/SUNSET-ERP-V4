"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { money, sumMoney, toDecimal } from "@/lib/decimal";
import {
  AsientoError,
  anularAsiento,
  contabilizarAsiento,
  crearAsientoVenta,
} from "@/lib/services/asiento-automatico";
import {
  CondicionPago,
  Moneda,
  Prisma,
  VentaEstado,
} from "@/generated/prisma/client";

export type VentaRow = {
  id: string;
  numero: string;
  fecha: string;
  fechaVencimiento: string | null;
  cliente: { id: string; nombre: string };
  moneda: Moneda;
  subtotal: string;
  iva: string;
  total: string;
  estado: VentaEstado;
  asientoId: string | null;
};

export type ClienteParaVenta = {
  id: string;
  nombre: string;
  diasPagoDefault: number | null;
  condicionPagoDefault: CondicionPago;
};

export type ProductoParaVenta = {
  id: string;
  codigo: string;
  nombre: string;
  precioVenta: string;
};

export async function listarVentas(): Promise<VentaRow[]> {
  const rows = await db.venta.findMany({
    orderBy: { createdAt: "desc" },
    include: { cliente: { select: { id: true, nombre: true } } },
  });
  return rows.map((v) => ({
    id: v.id,
    numero: v.numero,
    fecha: v.fecha.toISOString(),
    fechaVencimiento: v.fechaVencimiento?.toISOString() ?? null,
    cliente: v.cliente,
    moneda: v.moneda,
    subtotal: v.subtotal.toString(),
    iva: v.iva.toString(),
    total: v.total.toString(),
    estado: v.estado,
    asientoId: v.asientoId,
  }));
}

export async function listarClientesParaVenta(): Promise<ClienteParaVenta[]> {
  const rows = await db.cliente.findMany({
    where: { estado: "activo" },
    orderBy: { nombre: "asc" },
    select: {
      id: true,
      nombre: true,
      diasPagoDefault: true,
      condicionPagoDefault: true,
    },
  });
  return rows.map((c) => ({
    id: c.id,
    nombre: c.nombre,
    diasPagoDefault: c.diasPagoDefault,
    condicionPagoDefault: c.condicionPagoDefault,
  }));
}

export async function listarProductosParaVenta(): Promise<ProductoParaVenta[]> {
  const rows = await db.producto.findMany({
    where: { activo: true },
    orderBy: { codigo: "asc" },
    select: { id: true, codigo: true, nombre: true, precioVenta: true },
  });
  return rows.map((p) => ({
    id: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    precioVenta: p.precioVenta.toString(),
  }));
}

export type VentaDetalle = {
  id: string;
  numero: string;
  clienteId: string;
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
  estado: VentaEstado;
  asientoId: string | null;
  pedidoVentaId: number | null;
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

export async function obtenerVentaPorId(
  id: string,
): Promise<VentaDetalle | null> {
  const v = await db.venta.findUnique({
    where: { id },
    include: { items: { orderBy: { id: "asc" } } },
  });
  if (!v) return null;
  return {
    id: v.id,
    numero: v.numero,
    clienteId: v.clienteId,
    fecha: v.fecha.toISOString(),
    fechaVencimiento: v.fechaVencimiento?.toISOString() ?? null,
    condicionPago: v.condicionPago,
    moneda: v.moneda,
    tipoCambio: v.tipoCambio.toString(),
    subtotal: v.subtotal.toString(),
    iva: v.iva.toString(),
    iibb: v.iibb.toString(),
    otros: v.otros.toString(),
    total: v.total.toString(),
    estado: v.estado,
    asientoId: v.asientoId,
    pedidoVentaId: v.pedidoVentaId,
    notas: v.notas,
    items: v.items.map((it) => ({
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

export async function generarNumeroVenta(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `V-${year}-`;
  const ultimo = await db.venta.findFirst({
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

const ventaInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    numero: z.string().min(1).max(32),
    clienteId: z.string().uuid("Seleccione cliente"),
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

export type VentaInput = z.input<typeof ventaInputSchema>;

export type VentaActionResult =
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

export async function guardarVentaAction(
  raw: VentaInput,
): Promise<VentaActionResult> {
  const parsed = ventaInputSchema.safeParse(raw);
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
        clienteId: input.clienteId,
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
        const actual = await tx.venta.findUnique({
          where: { id: input.id },
          select: { estado: true, asientoId: true },
        });
        if (!actual) throw new Error("Venta no existe.");
        if (actual.asientoId) {
          throw new Error("Venta ya emitida; anule el asiento para editar.");
        }
        const v = await tx.venta.update({
          where: { id: input.id },
          data,
        });
        await tx.itemVenta.deleteMany({ where: { ventaId: v.id } });
        id = v.id;
      } else {
        const v = await tx.venta.create({ data });
        id = v.id;
      }

      await tx.itemVenta.createMany({
        data: itemsCalc.map((it) => ({
          ventaId: id,
          productoId: it.productoId,
          cantidad: it.cantidad,
          precioUnitario: money(it.precioUnitario),
          subtotal: money(it.subtotal),
          iva: money(it.iva),
          total: money(it.total),
        })),
      });

      return tx.venta.findUniqueOrThrow({
        where: { id },
        select: { id: true, numero: true },
      });
    });

    revalidatePath("/ventas");
    revalidatePath(`/ventas/${saved.id}`);
    return { ok: true, id: saved.id, numero: saved.numero };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return { ok: false, error: `El número "${input.numero}" ya existe.` };
    }
    if (err instanceof Error) return { ok: false, error: err.message };
    return { ok: false, error: "Error inesperado al guardar la venta." };
  }
}

export async function emitirVentaAction(
  ventaId: string,
): Promise<{ ok: true; numeroAsiento: number } | { ok: false; error: string }> {
  try {
    const result = await db.$transaction(async (tx) => {
      const v = await tx.venta.findUnique({
        where: { id: ventaId },
        select: { estado: true, asientoId: true, numero: true },
      });
      if (!v) throw new AsientoError("DOMINIO_INVALIDO", "Venta no existe.");
      if (v.asientoId) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          `Venta ${v.numero} ya tiene asiento.`,
        );
      }
      const asiento = await crearAsientoVenta(ventaId, tx);
      const cont = await contabilizarAsiento(asiento.id, tx);
      await tx.venta.update({
        where: { id: ventaId },
        data: { estado: VentaEstado.EMITIDA },
      });
      return cont.numero;
    });
    revalidatePath("/ventas");
    revalidatePath(`/ventas/${ventaId}`);
    return { ok: true, numeroAsiento: result };
  } catch (err) {
    if (err instanceof AsientoError) return { ok: false, error: err.message };
    return { ok: false, error: "Error al emitir la venta." };
  }
}

export async function anularVentaAction(
  ventaId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const v = await db.venta.findUnique({
      where: { id: ventaId },
      select: { asientoId: true },
    });
    if (!v) return { ok: false, error: "Venta no existe." };
    if (!v.asientoId) {
      // Sin asiento: solo marcar cancelada.
      await db.venta.update({
        where: { id: ventaId },
        data: { estado: VentaEstado.CANCELADA },
      });
    } else {
      await anularAsiento(v.asientoId);
      // anularEnTx ya cancela y desvincula la venta.
    }
    revalidatePath("/ventas");
    revalidatePath(`/ventas/${ventaId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof AsientoError) return { ok: false, error: err.message };
    return { ok: false, error: "Error al anular la venta." };
  }
}
