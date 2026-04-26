"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { money, sumMoney, toDecimal } from "@/lib/decimal";
import {
  CompraEstado,
  CondicionPago,
  Moneda,
  PedidoEstado,
  Prisma,
} from "@/generated/prisma/client";

export type PedidoCompraRow = {
  id: number;
  numero: string;
  fecha: string;
  fechaPrevista: string | null;
  proveedor: { id: string; nombre: string };
  moneda: Moneda;
  total: string; // suma items × cantidad
  estado: PedidoEstado;
  itemsCount: number;
};

export async function listarPedidosCompra(): Promise<PedidoCompraRow[]> {
  const rows = await db.pedidoCompra.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      proveedor: { select: { id: true, nombre: true } },
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
      proveedor: p.proveedor,
      moneda: p.moneda,
      total: total.toString(),
      estado: p.estado,
      itemsCount: p.items.length,
    };
  });
}

export type PedidoCompraDetalle = {
  id: number;
  numero: string;
  proveedorId: string;
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

export async function obtenerPedidoCompraPorId(
  id: number,
): Promise<PedidoCompraDetalle | null> {
  const p = await db.pedidoCompra.findUnique({
    where: { id },
    include: { items: { orderBy: { id: "asc" } } },
  });
  if (!p) return null;
  return {
    id: p.id,
    numero: p.numero,
    proveedorId: p.proveedorId,
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

export async function generarNumeroPedidoCompra(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `OC-${year}-`;
  const ultimo = await db.pedidoCompra.findFirst({
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
    proveedorId: z.string().uuid("Seleccione proveedor"),
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

export type PedidoCompraInput = z.input<typeof inputSchema>;

export type PedidoCompraResult =
  | { ok: true; id: number; numero: string }
  | { ok: false; error: string };

export async function guardarPedidoCompraAction(
  raw: PedidoCompraInput,
): Promise<PedidoCompraResult> {
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
        proveedorId: input.proveedorId,
        fecha: new Date(input.fecha),
        fechaPrevista: input.fechaPrevista ? new Date(input.fechaPrevista) : null,
        moneda: input.moneda,
        tipoCambio: new Prisma.Decimal(input.tipoCambio),
        observaciones: input.observaciones,
      };

      let id: number;
      if (input.id) {
        const actual = await tx.pedidoCompra.findUnique({
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
        const p = await tx.pedidoCompra.update({
          where: { id: input.id },
          data,
        });
        await tx.itemPedidoCompra.deleteMany({ where: { pedidoCompraId: p.id } });
        id = p.id;
      } else {
        const p = await tx.pedidoCompra.create({ data });
        id = p.id;
      }

      await tx.itemPedidoCompra.createMany({
        data: input.items.map((it) => ({
          pedidoCompraId: id,
          productoId: it.productoId,
          cantidad: it.cantidad,
          precioUnitario: money(it.precioUnitario),
        })),
      });

      return tx.pedidoCompra.findUniqueOrThrow({
        where: { id },
        select: { id: true, numero: true },
      });
    });

    revalidatePath("/compras/pedidos");
    revalidatePath(`/compras/pedidos/${saved.id}`);
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

export async function transicionarPedidoCompraAction(
  id: number,
  nuevoEstado: PedidoEstado,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await db.pedidoCompra.update({
      where: { id },
      data: { estado: nuevoEstado },
    });
    revalidatePath("/compras/pedidos");
    revalidatePath(`/compras/pedidos/${id}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Error al actualizar el estado del pedido." };
  }
}

/**
 * Crea una Compra en BORRADOR a partir del pedido. La factura puede luego
 * editarse y emitirse desde /compras/[id]. No mueve estado del pedido —
 * eso se hace manualmente cuando el usuario confirma que está completo.
 */
export async function crearCompraDesdePedidoAction(
  pedidoId: number,
): Promise<{ ok: true; compraId: string; numero: string } | { ok: false; error: string }> {
  try {
    const pedido = await db.pedidoCompra.findUnique({
      where: { id: pedidoId },
      include: {
        items: { orderBy: { id: "asc" } },
        proveedor: {
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

    // Calcular números basados en items, IVA 21% por defecto
    const subtotalCalc = sumMoney(
      pedido.items.map((it) =>
        toDecimal(it.precioUnitario).times(it.cantidad),
      ),
    );
    const ivaCalc = toDecimal(subtotalCalc).times(0.21).toDecimalPlaces(2);
    const totalCalc = toDecimal(subtotalCalc).plus(ivaCalc).toDecimalPlaces(2);

    // Generar número de compra
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
    const numero = `${prefix}${String(next).padStart(4, "0")}`;

    const fecha = new Date();
    const dias = pedido.proveedor.diasPagoDefault ?? 0;
    const fechaVencimiento = new Date(fecha);
    fechaVencimiento.setDate(fechaVencimiento.getDate() + dias);

    const compra = await db.$transaction(async (tx) => {
      const c = await tx.compra.create({
        data: {
          numero,
          proveedorId: pedido.proveedorId,
          fecha,
          fechaVencimiento: dias > 0 ? fechaVencimiento : null,
          condicionPago: pedido.proveedor.condicionPagoDefault,
          moneda: pedido.moneda,
          tipoCambio: pedido.tipoCambio,
          subtotal: money(subtotalCalc),
          iva: money(ivaCalc),
          iibb: money("0"),
          otros: money("0"),
          total: money(totalCalc),
          estado: CompraEstado.BORRADOR,
          pedidoCompraId: pedido.id,
          notas: `Creada desde pedido ${pedido.numero}`,
        },
      });

      await tx.itemCompra.createMany({
        data: pedido.items.map((it) => {
          const sub = toDecimal(it.precioUnitario)
            .times(it.cantidad)
            .toDecimalPlaces(2);
          const iva = sub.times(0.21).toDecimalPlaces(2);
          return {
            compraId: c.id,
            productoId: it.productoId,
            cantidad: it.cantidad,
            precioUnitario: money(it.precioUnitario.toString()),
            subtotal: money(sub),
            iva: money(iva),
            total: money(sub.plus(iva)),
          };
        }),
      });

      return c;
    });

    revalidatePath("/compras");
    revalidatePath(`/compras/${compra.id}`);
    revalidatePath(`/compras/pedidos/${pedidoId}`);

    return { ok: true, compraId: compra.id, numero: compra.numero };
  } catch (err) {
    if (err instanceof Error) return { ok: false, error: err.message };
    return { ok: false, error: "Error al crear factura desde pedido." };
  }
}

// Helpers para combobox (reutilizan los de compras pero centralizados)
export async function listarProveedoresParaPedidoCompra() {
  const rows = await db.proveedor.findMany({
    orderBy: { nombre: "asc" },
    select: { id: true, nombre: true, pais: true },
  });
  return rows;
}

export async function listarProductosParaPedidoCompra() {
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
