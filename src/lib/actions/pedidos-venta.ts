"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { money, sumMoney, toDecimal } from "@/lib/decimal";
import {
  Moneda,
  PedidoEstado,
  Prisma,
  VentaEstado,
} from "@/generated/prisma/client";

export type PedidoVentaRow = {
  id: number;
  numero: string;
  fecha: string;
  fechaPrevista: string | null;
  cliente: { id: string; nombre: string };
  moneda: Moneda;
  total: string;
  estado: PedidoEstado;
  itemsCount: number;
};

export async function listarPedidosVenta(): Promise<PedidoVentaRow[]> {
  const rows = await db.pedidoVenta.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      cliente: { select: { id: true, nombre: true } },
      items: { select: { cantidad: true, precioUnitario: true } },
    },
  });
  return rows.map((p) => {
    const total = sumMoney(
      p.items.map((it) => toDecimal(it.precioUnitario).times(it.cantidad)),
    );
    return {
      id: p.id,
      numero: p.numero,
      fecha: p.fecha.toISOString(),
      fechaPrevista: p.fechaPrevista?.toISOString() ?? null,
      cliente: p.cliente,
      moneda: p.moneda,
      total: total.toString(),
      estado: p.estado,
      itemsCount: p.items.length,
    };
  });
}

export type PedidoVentaDetalle = {
  id: number;
  numero: string;
  clienteId: string;
  fecha: string;
  fechaPrevista: string | null;
  moneda: Moneda;
  tipoCambio: string;
  estado: PedidoEstado;
  observaciones: string | null;
  items: Array<{
    id: number;
    productoId: string;
    cantidad: number;
    precioUnitario: string;
  }>;
};

export async function obtenerPedidoVentaPorId(
  id: number,
): Promise<PedidoVentaDetalle | null> {
  const p = await db.pedidoVenta.findUnique({
    where: { id },
    include: { items: { orderBy: { id: "asc" } } },
  });
  if (!p) return null;
  return {
    id: p.id,
    numero: p.numero,
    clienteId: p.clienteId,
    fecha: p.fecha.toISOString(),
    fechaPrevista: p.fechaPrevista?.toISOString() ?? null,
    moneda: p.moneda,
    tipoCambio: p.tipoCambio.toString(),
    estado: p.estado,
    observaciones: p.observaciones,
    items: p.items.map((it) => ({
      id: it.id,
      productoId: it.productoId,
      cantidad: it.cantidad,
      precioUnitario: it.precioUnitario.toString(),
    })),
  };
}

export async function generarNumeroPedidoVenta(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `OV-${year}-`;
  const ultimo = await db.pedidoVenta.findFirst({
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
  cantidad: z.coerce.number().int().positive("Cantidad > 0"),
  precioUnitario: z.string().regex(moneyRegex, "Precio inválido"),
});

const inputSchema = z
  .object({
    id: z.coerce.number().int().positive().optional(),
    numero: z.string().min(1).max(32),
    clienteId: z.string().uuid("Seleccione cliente"),
    fecha: z.string().min(1),
    fechaPrevista: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v : null)),
    moneda: z.nativeEnum(Moneda),
    tipoCambio: z.string().regex(rateRegex, "TC inválido"),
    observaciones: z
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
  });

export type PedidoVentaInput = z.input<typeof inputSchema>;

export type PedidoVentaResult =
  | { ok: true; id: number; numero: string }
  | { ok: false; error: string };

export async function guardarPedidoVentaAction(
  raw: PedidoVentaInput,
): Promise<PedidoVentaResult> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: `${first.path.join(".")}: ${first.message}` };
  }
  const input = parsed.data;

  try {
    const saved = await db.$transaction(async (tx) => {
      const data = {
        numero: input.numero,
        clienteId: input.clienteId,
        fecha: new Date(input.fecha),
        fechaPrevista: input.fechaPrevista ? new Date(input.fechaPrevista) : null,
        moneda: input.moneda,
        tipoCambio: new Prisma.Decimal(input.tipoCambio),
        observaciones: input.observaciones,
      };

      let id: number;
      if (input.id) {
        const actual = await tx.pedidoVenta.findUnique({
          where: { id: input.id },
          select: { estado: true },
        });
        if (!actual) throw new Error("Pedido no existe.");
        if (
          actual.estado !== PedidoEstado.BORRADOR &&
          actual.estado !== PedidoEstado.ENVIADO
        ) {
          throw new Error(
            "Sólo se pueden editar pedidos en estado BORRADOR o ENVIADO.",
          );
        }
        const p = await tx.pedidoVenta.update({
          where: { id: input.id },
          data,
        });
        await tx.itemPedidoVenta.deleteMany({ where: { pedidoVentaId: p.id } });
        id = p.id;
      } else {
        const p = await tx.pedidoVenta.create({ data });
        id = p.id;
      }

      await tx.itemPedidoVenta.createMany({
        data: input.items.map((it) => ({
          pedidoVentaId: id,
          productoId: it.productoId,
          cantidad: it.cantidad,
          precioUnitario: money(it.precioUnitario),
        })),
      });

      return tx.pedidoVenta.findUniqueOrThrow({
        where: { id },
        select: { id: true, numero: true },
      });
    });

    revalidatePath("/ventas/pedidos");
    revalidatePath(`/ventas/pedidos/${saved.id}`);
    return { ok: true, id: saved.id, numero: saved.numero };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return { ok: false, error: `Número "${input.numero}" ya existe.` };
    }
    if (err instanceof Error) return { ok: false, error: err.message };
    return { ok: false, error: "Error al guardar el pedido." };
  }
}

export async function transicionarPedidoVentaAction(
  id: number,
  nuevoEstado: PedidoEstado,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await db.pedidoVenta.update({
      where: { id },
      data: { estado: nuevoEstado },
    });
    revalidatePath("/ventas/pedidos");
    revalidatePath(`/ventas/pedidos/${id}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Error al actualizar el estado del pedido." };
  }
}

export async function crearVentaDesdePedidoAction(
  pedidoId: number,
): Promise<{ ok: true; ventaId: string; numero: string } | { ok: false; error: string }> {
  try {
    const pedido = await db.pedidoVenta.findUnique({
      where: { id: pedidoId },
      include: {
        items: { orderBy: { id: "asc" } },
        cliente: {
          select: { diasPagoDefault: true, condicionPagoDefault: true },
        },
      },
    });
    if (!pedido) return { ok: false, error: "Pedido no existe." };

    if (
      pedido.estado === PedidoEstado.CANCELADO ||
      pedido.estado === PedidoEstado.COMPLETADO
    ) {
      return {
        ok: false,
        error: `No se puede facturar un pedido en estado ${pedido.estado}.`,
      };
    }

    const subtotalCalc = sumMoney(
      pedido.items.map((it) =>
        toDecimal(it.precioUnitario).times(it.cantidad),
      ),
    );
    const ivaCalc = toDecimal(subtotalCalc).times(0.21).toDecimalPlaces(2);
    const totalCalc = toDecimal(subtotalCalc).plus(ivaCalc).toDecimalPlaces(2);

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
    const numero = `${prefix}${String(next).padStart(4, "0")}`;

    const fecha = new Date();
    const dias = pedido.cliente.diasPagoDefault ?? 0;
    const fechaVencimiento = new Date(fecha);
    fechaVencimiento.setDate(fechaVencimiento.getDate() + dias);

    const venta = await db.$transaction(async (tx) => {
      const v = await tx.venta.create({
        data: {
          numero,
          clienteId: pedido.clienteId,
          fecha,
          fechaVencimiento: dias > 0 ? fechaVencimiento : null,
          condicionPago: pedido.cliente.condicionPagoDefault,
          moneda: pedido.moneda,
          tipoCambio: pedido.tipoCambio,
          subtotal: money(subtotalCalc),
          iva: money(ivaCalc),
          iibb: money("0"),
          otros: money("0"),
          total: money(totalCalc),
          estado: VentaEstado.BORRADOR,
          pedidoVentaId: pedido.id,
          notas: `Creada desde pedido ${pedido.numero}`,
        },
      });

      await tx.itemVenta.createMany({
        data: pedido.items.map((it) => {
          const sub = toDecimal(it.precioUnitario)
            .times(it.cantidad)
            .toDecimalPlaces(2);
          const iva = sub.times(0.21).toDecimalPlaces(2);
          return {
            ventaId: v.id,
            productoId: it.productoId,
            cantidad: it.cantidad,
            precioUnitario: money(it.precioUnitario.toString()),
            subtotal: money(sub),
            iva: money(iva),
            total: money(sub.plus(iva)),
          };
        }),
      });

      return v;
    });

    revalidatePath("/ventas");
    revalidatePath(`/ventas/${venta.id}`);
    revalidatePath(`/ventas/pedidos/${pedidoId}`);

    return { ok: true, ventaId: venta.id, numero: venta.numero };
  } catch (err) {
    if (err instanceof Error) return { ok: false, error: err.message };
    return { ok: false, error: "Error al crear factura desde pedido." };
  }
}

export async function listarClientesParaPedidoVenta() {
  const rows = await db.cliente.findMany({
    where: { estado: "activo" },
    orderBy: { nombre: "asc" },
    select: { id: true, nombre: true, diasPagoDefault: true },
  });
  return rows.map((c) => ({
    id: c.id,
    nombre: c.nombre,
    diasPagoDefault: c.diasPagoDefault,
  }));
}

export async function listarProductosParaPedidoVenta() {
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
